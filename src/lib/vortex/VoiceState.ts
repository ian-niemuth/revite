import { action, makeAutoObservable, runInAction } from "mobx";

import { clientController } from "../../controllers/client/ClientController";
import type { ProduceType, VoiceUser } from "./Types";

export enum VoiceStatus {
    LOADING = 0,
    UNAVAILABLE,
    ERRORED,
    READY = 3,
    CONNECTING = 4,
    UNLOADED = 5,
    AUTHENTICATING,
    RTC_CONNECTING,
    CONNECTED,
}

export const VOICE_ROOMS = [
    { id: "general", name: "General" },
    { id: "gaming", name: "Gaming" },
    { id: "afk", name: "AFK" },
] as const;

interface RoomInfo {
    count: number;
    participants: { identity: string; name: string }[];
}

// Generate short chime tones via Web Audio API
function playChime(type: "join" | "leave") {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0.15, ctx.currentTime);

        if (type === "join") {
            // Rising two-tone: G5 → C6
            osc.frequency.setValueAtTime(784, ctx.currentTime);
            osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.08);
        } else {
            // Falling two-tone: C6 → G5
            osc.frequency.setValueAtTime(1047, ctx.currentTime);
            osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08);
        }

        osc.type = "sine";
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);

        // Clean up
        osc.onended = () => ctx.close();
    } catch {
        // Audio not available
    }
}

class VoiceStateReference {
    status: VoiceStatus;
    roomId: string | null;
    roomName: string | null;
    participants: Map<string, VoiceUser>;
    participantNames: Map<string, string>;
    participantCounts: Map<string, number>;
    roomParticipants: Map<string, { identity: string; name: string }[]>;

    // QoL feature observables
    speakingParticipants: Map<string, boolean>;
    connectionQualities: Map<string, string>;
    userVolumes: Map<string, number>;
    krispEnabled: boolean;

    private room: any; // LiveKit Room instance
    private deaf: boolean;
    private producing: boolean;
    private krispProcessor: any; // Krisp noise filter processor instance

    constructor() {
        this.roomId = null;
        this.roomName = null;
        this.status = VoiceStatus.READY;
        this.participants = new Map();
        this.participantNames = new Map();
        this.participantCounts = new Map();
        this.roomParticipants = new Map();
        this.room = null;
        this.deaf = false;
        this.producing = false;

        // QoL feature init
        this.speakingParticipants = new Map();
        this.connectionQualities = new Map();
        this.krispEnabled =
            localStorage.getItem("avreth:krisp") !== "false"; // default true
        this.krispProcessor = null;

        // Load persisted user volumes
        this.userVolumes = new Map();
        try {
            const saved = localStorage.getItem("avreth:userVolumes");
            if (saved) {
                const parsed = JSON.parse(saved);
                for (const [k, v] of Object.entries(parsed)) {
                    this.userVolumes.set(k, v as number);
                }
            }
        } catch {
            // ignore
        }

        this.disconnect = this.disconnect.bind(this);

        makeAutoObservable(this, {
            room: false,
        });

        // Start polling room info
        this.pollRoomCounts();

        // Listen for desktop app commands (Avreth Desktop sends these via postMessage)
        if (typeof window !== "undefined") {
            window.addEventListener("message", (e) => {
                if (e.data?.type !== "avreth-desktop") return;
                switch (e.data.command) {
                    case "toggle-mute":
                        this.toggleMute();
                        break;
                    case "toggle-deafen":
                        this.toggleDeafen();
                        break;
                    case "disconnect":
                        this.disconnect();
                        break;
                }
            });
        }
    }

    get localIdentity(): string | null {
        return this.room?.localParticipant?.identity ?? null;
    }

    private async pollRoomCounts() {
        const poll = async () => {
            try {
                const resp = await fetch("/voice/rooms");
                if (resp.ok) {
                    const rooms: Record<string, RoomInfo> = await resp.json();
                    runInAction(() => {
                        for (const [room, info] of Object.entries(rooms)) {
                            this.participantCounts.set(room, info.count);
                            this.roomParticipants.set(
                                room,
                                info.participants,
                            );
                        }
                    });
                }
            } catch {
                // Silently fail — voice service may not be up
            }
        };

        poll();
        setInterval(poll, 5000);
    }

    @action async connect(roomId: string) {
        if (this.status === VoiceStatus.CONNECTED) {
            this.disconnect();
        }

        this.status = VoiceStatus.CONNECTING;
        this.roomId = roomId;

        const roomInfo = VOICE_ROOMS.find((r) => r.id === roomId);
        this.roomName = roomInfo?.name ?? roomId;

        try {
            // Get session token from the active client session
            const sessionToken =
                clientController.getActiveSession()?.client?.session?.token;

            if (!sessionToken) {
                throw new Error("No session token found");
            }

            // Request LiveKit token from voice-auth
            const resp = await fetch("/voice/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room: roomId,
                    session_token: sessionToken,
                }),
            });

            if (!resp.ok) {
                throw new Error("Failed to get voice token");
            }

            const { token, url } = await resp.json();

            runInAction(() => {
                this.status = VoiceStatus.RTC_CONNECTING;
            });

            // Dynamically import livekit-client
            const { Room, RoomEvent, Track, ConnectionQuality } = await import(
                "livekit-client"
            );

            const roomOptions: any = {
                adaptiveStream: false,
                dynacast: false,
                audioCaptureDefaults: {
                    autoGainControl: true,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            };

            // Apply saved audio input device
            const savedInput = localStorage.getItem("avreth:audioInput");
            if (savedInput) {
                roomOptions.audioCaptureDefaults.deviceId = savedInput;
            }

            const lkRoom = new Room(roomOptions);

            const savedOutput = localStorage.getItem("avreth:audioOutput");

            // Set up event listeners
            lkRoom.on(RoomEvent.ParticipantConnected, () => {
                playChime("join");
                this.syncParticipants(lkRoom);
            });

            lkRoom.on(RoomEvent.ParticipantDisconnected, () => {
                playChime("leave");
                this.syncParticipants(lkRoom);
            });

            lkRoom.on(
                RoomEvent.TrackSubscribed,
                (track: any, _pub: any, participant: any) => {
                    // Attach audio tracks to DOM so they actually play
                    if (track.kind === "audio") {
                        const el = track.attach();
                        el.id = `lk-audio-${track.sid}`;
                        document.body.appendChild(el);
                    }
                    this.syncParticipants(lkRoom);
                    if (this.deaf) {
                        this.muteAllRemote();
                    }

                    // Apply saved per-user volume
                    const savedVol = this.userVolumes.get(
                        participant.identity,
                    );
                    if (savedVol !== undefined) {
                        try {
                            participant.setVolume(savedVol);
                        } catch {
                            // ignore
                        }
                    }
                },
            );

            lkRoom.on(RoomEvent.TrackUnsubscribed, (track: any) => {
                // Detach and remove audio elements
                track
                    .detach()
                    .forEach((el: HTMLMediaElement) => el.remove());
                this.syncParticipants(lkRoom);
            });

            lkRoom.on(RoomEvent.TrackMuted, () => {
                this.syncParticipants(lkRoom);
            });

            lkRoom.on(RoomEvent.TrackUnmuted, () => {
                this.syncParticipants(lkRoom);
            });

            lkRoom.on(RoomEvent.Disconnected, () => {
                runInAction(() => {
                    this.status = VoiceStatus.READY;
                    this.roomId = null;
                    this.roomName = null;
                    this.participants.clear();
                    this.participantNames.clear();
                    this.speakingParticipants.clear();
                    this.connectionQualities.clear();
                    this.room = null;
                    this.producing = false;
                    this.krispProcessor = null;
                });
            });

            // Speaking indicators
            lkRoom.on(
                RoomEvent.ActiveSpeakersChanged,
                (speakers: any[]) => {
                    runInAction(() => {
                        // Reset all to not speaking
                        for (const key of this.speakingParticipants.keys()) {
                            this.speakingParticipants.set(key, false);
                        }
                        // Set active speakers
                        for (const speaker of speakers) {
                            this.speakingParticipants.set(
                                speaker.identity,
                                true,
                            );
                        }
                    });
                },
            );

            // Connection quality indicators
            lkRoom.on(
                RoomEvent.ConnectionQualityChanged,
                (quality: string, participant: any) => {
                    runInAction(() => {
                        this.connectionQualities.set(
                            participant.identity,
                            quality,
                        );
                    });
                },
            );

            await lkRoom.connect(url, token);

            // Play join chime for ourselves
            playChime("join");

            // Apply saved output device after connect
            if (savedOutput) {
                try {
                    await lkRoom.switchActiveDevice(
                        "audiooutput",
                        savedOutput,
                    );
                } catch {
                    // Device may no longer exist
                }
            }

            runInAction(() => {
                this.room = lkRoom;
                this.status = VoiceStatus.CONNECTED;
                this.syncParticipants(lkRoom);
            });

            // Auto-enable microphone
            await lkRoom.localParticipant.setMicrophoneEnabled(true);
            runInAction(() => {
                this.producing = true;
                this.syncParticipants(lkRoom);
            });

            // Apply Krisp noise suppression after mic is live (needs AudioContext)
            if (this.krispEnabled) {
                try {
                    const { KrispNoiseFilter, isKrispNoiseFilterSupported } =
                        await import("@livekit/krisp-noise-filter");
                    if (isKrispNoiseFilterSupported()) {
                        const processor = KrispNoiseFilter();
                        const micPub =
                            lkRoom.localParticipant.getTrackPublication(
                                Track.Source.Microphone,
                            );
                        if (micPub?.track) {
                            await micPub.track.setProcessor(processor);
                            this.krispProcessor = processor;
                        }
                    }
                } catch {
                    // Krisp not available, continue without it
                }
            }
        } catch (err) {
            console.error("Voice connect error:", err);
            runInAction(() => {
                this.status = VoiceStatus.READY;
                this.roomId = null;
                this.roomName = null;
            });
        }
    }

    @action syncParticipants(lkRoom: any) {
        this.participants.clear();
        this.participantNames.clear();

        // Add local participant
        const local = lkRoom.localParticipant;
        if (local) {
            const hasMic = local.isMicrophoneEnabled;
            this.participants.set(local.identity, { audio: hasMic });
            this.participantNames.set(
                local.identity,
                local.name || local.identity,
            );
        }

        // Add remote participants
        for (const [, participant] of lkRoom.remoteParticipants) {
            const hasAudio = Array.from(
                participant.audioTrackPublications.values(),
            ).some((pub: any) => !pub.isMuted);
            this.participants.set(participant.identity, { audio: hasAudio });
            this.participantNames.set(
                participant.identity,
                participant.name || participant.identity,
            );
        }
    }

    @action disconnect() {
        // Play leave chime
        playChime("leave");

        // Clean up all attached audio elements
        document
            .querySelectorAll("[id^='lk-audio-']")
            .forEach((el) => el.remove());

        if (this.room) {
            this.room.disconnect();
        }

        this.status = VoiceStatus.READY;
        this.roomId = null;
        this.roomName = null;
        this.participants.clear();
        this.participantNames.clear();
        this.speakingParticipants.clear();
        this.connectionQualities.clear();
        this.room = null;
        this.producing = false;
        this.deaf = false;
        this.krispProcessor = null;
    }

    isProducing(type: ProduceType) {
        switch (type) {
            case "audio":
                return this.producing;
        }
    }

    isDeaf() {
        return this.deaf;
    }

    private muteAllRemote() {
        document
            .querySelectorAll<HTMLAudioElement>("[id^='lk-audio-']")
            .forEach((el) => {
                el.muted = true;
            });
    }

    private unmuteAllRemote() {
        document
            .querySelectorAll<HTMLAudioElement>("[id^='lk-audio-']")
            .forEach((el) => {
                el.muted = false;
            });
    }

    @action async startDeafen() {
        this.deaf = true;
        this.muteAllRemote();
    }

    @action async stopDeafen() {
        this.deaf = false;
        this.unmuteAllRemote();
    }

    async toggleMute() {
        if (this.status !== VoiceStatus.CONNECTED) return;
        if (this.producing) {
            await this.stopProducing("audio");
        } else {
            await this.startProducing("audio");
        }
    }

    async toggleDeafen() {
        if (this.status !== VoiceStatus.CONNECTED) return;
        if (this.deaf) {
            await this.stopDeafen();
        } else {
            await this.startDeafen();
        }
    }

    async startProducing(type: ProduceType) {
        if (type !== "audio" || !this.room) return;

        try {
            await this.room.localParticipant.setMicrophoneEnabled(true);
            runInAction(() => {
                this.producing = true;
                if (this.room) this.syncParticipants(this.room);
            });
        } catch (err) {
            console.error("Failed to enable microphone:", err);
        }
    }

    async stopProducing(type: ProduceType) {
        if (type !== "audio" || !this.room) return;

        try {
            await this.room.localParticipant.setMicrophoneEnabled(false);
            runInAction(() => {
                this.producing = false;
                if (this.room) this.syncParticipants(this.room);
            });
        } catch (err) {
            console.error("Failed to disable microphone:", err);
        }
    }

    // --- Krisp Noise Suppression ---

    async toggleKrisp() {
        this.krispEnabled = !this.krispEnabled;
        localStorage.setItem(
            "avreth:krisp",
            this.krispEnabled ? "true" : "false",
        );

        if (!this.room) return;

        try {
            const { Track } = await import("livekit-client");
            const micPub = this.room.localParticipant.getTrackPublication(
                Track.Source.Microphone,
            );
            if (!micPub?.track) return;

            if (this.krispEnabled) {
                const { KrispNoiseFilter, isKrispNoiseFilterSupported } =
                    await import("@livekit/krisp-noise-filter");
                if (isKrispNoiseFilterSupported()) {
                    const processor = KrispNoiseFilter();
                    this.krispProcessor = processor;
                    await micPub.track.setProcessor(processor);
                }
            } else {
                await micPub.track.stopProcessor();
                this.krispProcessor = null;
            }
        } catch (err) {
            console.error("Failed to toggle Krisp:", err);
        }
    }

    // --- Device Selection ---

    async switchAudioInput(deviceId: string) {
        localStorage.setItem("avreth:audioInput", deviceId);
        if (!this.room) return;

        try {
            await this.room.switchActiveDevice("audioinput", deviceId);
        } catch (err) {
            console.error("Failed to switch audio input:", err);
        }
    }

    async switchAudioOutput(deviceId: string) {
        localStorage.setItem("avreth:audioOutput", deviceId);
        if (!this.room) return;

        try {
            await this.room.switchActiveDevice("audiooutput", deviceId);
        } catch (err) {
            console.error("Failed to switch audio output:", err);
        }
    }

    // --- Per-User Volume ---

    @action setUserVolume(identity: string, volume: number) {
        this.userVolumes.set(identity, volume);

        // Persist
        const obj: Record<string, number> = {};
        for (const [k, v] of this.userVolumes) {
            obj[k] = v;
        }
        localStorage.setItem("avreth:userVolumes", JSON.stringify(obj));

        // Apply to remote participant
        if (!this.room) return;
        const participant = this.room.remoteParticipants.get(identity);
        if (participant) {
            try {
                participant.setVolume(volume);
            } catch {
                // ignore
            }
        }
    }
}

export const voiceState = new VoiceStateReference();
