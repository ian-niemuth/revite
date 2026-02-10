import {
    Cog,
    Microphone,
    MicrophoneOff,
    PhoneOff,
    VolumeFull,
    VolumeMute,
} from "@styled-icons/boxicons-solid";
import { Volume } from "@styled-icons/boxicons-solid";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useState } from "preact/hooks";
import styled, { css, keyframes } from "styled-components/macro";

import { Category } from "@revoltchat/ui";

import {
    voiceState,
    VoiceStatus,
    VOICE_ROOMS,
} from "../../lib/vortex/VoiceState";

const PanelBase = styled.div`
    flex-shrink: 0;
    padding: 6px;
    background: var(--secondary-background);
    border-top: 1px solid var(--tertiary-background);
`;

const RoomButton = styled.div<{ active?: boolean }>`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: ${(props) =>
        props.active ? "var(--accent)" : "var(--secondary-foreground)"};
    font-weight: ${(props) => (props.active ? 600 : 400)};

    &:hover {
        background: var(--tertiary-background);
    }

    .count {
        margin-left: auto;
        font-size: 11px;
        opacity: 0.6;
    }
`;

const RoomMembers = styled.div`
    font-size: 11px;
    color: var(--tertiary-foreground);
    padding: 0 8px 4px 32px;
    line-height: 1.3;
`;

const ConnectedPanel = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
`;

const RoomLabel = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--success);
    padding: 2px 8px;

    svg {
        flex-shrink: 0;
    }
`;

const ParticipantList = styled.div`
    font-size: 12px;
    color: var(--secondary-foreground);
    padding: 0 8px;
    line-height: 1.6;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;
`;

const speakingGlow = keyframes`
    0%, 100% { text-shadow: 0 0 4px var(--success); }
    50% { text-shadow: 0 0 8px var(--success); }
`;

const ParticipantName = styled.span<{ speaking?: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: ${(props) =>
        props.speaking ? "var(--success)" : "var(--secondary-foreground)"};
    transition: color 0.2s ease, text-shadow 0.2s ease;
    ${(props) =>
        props.speaking
            ? css`animation: ${speakingGlow} 1.5s ease-in-out infinite;`
            : ""}
    cursor: default;
`;

const QualityDot = styled.span<{ quality?: string }>`
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: ${(props) => {
        switch (props.quality) {
            case "excellent":
            case "good":
                return "var(--success)";
            case "poor":
                return "var(--warning)";
            case "lost":
                return "var(--error)";
            default:
                return "var(--tertiary-foreground)";
        }
    }};
`;

const Controls = styled.div`
    display: flex;
    gap: 4px;
    padding: 2px 4px;
`;

const ControlButton = styled.button<{ danger?: boolean; active?: boolean }>`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: ${(props) =>
        props.danger
            ? "var(--error)"
            : props.active
            ? "var(--tertiary-background)"
            : "transparent"};
    color: ${(props) =>
        props.danger ? "white" : "var(--secondary-foreground)"};

    &:hover {
        background: ${(props) =>
            props.danger ? "var(--error)" : "var(--tertiary-background)"};
    }

    svg {
        width: 18px;
        height: 18px;
    }
`;

// Settings popup
const PopupOverlay = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9998;
`;

const SettingsPopupContainer = styled.div`
    position: absolute;
    bottom: 100%;
    left: 4px;
    right: 4px;
    margin-bottom: 4px;
    background: var(--primary-background);
    border: 1px solid var(--tertiary-background);
    border-radius: 6px;
    padding: 10px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
`;

const SettingsLabel = styled.label`
    font-size: 11px;
    font-weight: 600;
    color: var(--secondary-foreground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
`;

const SettingsSelect = styled.select`
    width: 100%;
    padding: 4px 6px;
    font-size: 12px;
    background: var(--secondary-background);
    color: var(--foreground);
    border: 1px solid var(--tertiary-background);
    border-radius: 4px;
    outline: none;

    &:focus {
        border-color: var(--accent);
    }
`;

const SettingsRow = styled.div`
    display: flex;
    flex-direction: column;
    gap: 3px;
`;

const ToggleRow = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
`;

const ToggleSwitch = styled.button<{ on?: boolean }>`
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    position: relative;
    background: ${(props) =>
        props.on ? "var(--accent)" : "var(--tertiary-background)"};
    transition: background 0.2s ease;

    &::after {
        content: "";
        position: absolute;
        top: 2px;
        left: ${(props) => (props.on ? "18px" : "2px")};
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        transition: left 0.2s ease;
    }
`;

// Volume popup
const VolumePopupContainer = styled.div<{ x: number; y: number }>`
    position: fixed;
    left: ${(props) => props.x}px;
    top: ${(props) => props.y}px;
    background: var(--primary-background);
    border: 1px solid var(--tertiary-background);
    border-radius: 6px;
    padding: 10px;
    z-index: 10000;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 6px;
`;

const VolumeLabel = styled.div`
    font-size: 12px;
    font-weight: 600;
    color: var(--foreground);
`;

const VolumeSliderRow = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
`;

const VolumeSlider = styled.input`
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--tertiary-background);
    border-radius: 2px;
    outline: none;

    &::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--accent);
        cursor: pointer;
    }

    &::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--accent);
        cursor: pointer;
        border: none;
    }
`;

const VolumePercent = styled.span`
    font-size: 11px;
    color: var(--secondary-foreground);
    min-width: 32px;
    text-align: right;
`;

// Settings popup component
const SettingsPopup = observer(
    ({ onClose }: { onClose: () => void }) => {
        const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
        const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>(
            [],
        );
        const [selectedInput, setSelectedInput] = useState(
            localStorage.getItem("avreth:audioInput") ?? "",
        );
        const [selectedOutput, setSelectedOutput] = useState(
            localStorage.getItem("avreth:audioOutput") ?? "",
        );

        useEffect(() => {
            navigator.mediaDevices.enumerateDevices().then((devices) => {
                setInputDevices(
                    devices.filter((d) => d.kind === "audioinput"),
                );
                setOutputDevices(
                    devices.filter((d) => d.kind === "audiooutput"),
                );
            });
        }, []);

        return (
            <>
                <PopupOverlay onClick={onClose} />
                <SettingsPopupContainer>
                    <SettingsRow>
                        <SettingsLabel>Microphone</SettingsLabel>
                        <SettingsSelect
                            value={selectedInput}
                            onChange={(e: any) => {
                                const val = e.target.value;
                                setSelectedInput(val);
                                voiceState.switchAudioInput(val);
                            }}>
                            <option value="">Default</option>
                            {inputDevices.map((d) => (
                                <option key={d.deviceId} value={d.deviceId}>
                                    {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                                </option>
                            ))}
                        </SettingsSelect>
                    </SettingsRow>
                    <SettingsRow>
                        <SettingsLabel>Speaker</SettingsLabel>
                        <SettingsSelect
                            value={selectedOutput}
                            onChange={(e: any) => {
                                const val = e.target.value;
                                setSelectedOutput(val);
                                voiceState.switchAudioOutput(val);
                            }}>
                            <option value="">Default</option>
                            {outputDevices.map((d) => (
                                <option key={d.deviceId} value={d.deviceId}>
                                    {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                                </option>
                            ))}
                        </SettingsSelect>
                    </SettingsRow>
                    <ToggleRow>
                        <SettingsLabel>Noise Suppression</SettingsLabel>
                        <ToggleSwitch
                            on={voiceState.krispEnabled}
                            onClick={() => voiceState.toggleKrisp()}
                        />
                    </ToggleRow>
                </SettingsPopupContainer>
            </>
        );
    },
);

// Volume popup component
const VolumePopup = observer(
    ({
        identity,
        name,
        x,
        y,
        onClose,
    }: {
        identity: string;
        name: string;
        x: number;
        y: number;
        onClose: () => void;
    }) => {
        const currentVol = voiceState.userVolumes.get(identity) ?? 1;
        const percent = Math.round(currentVol * 100);

        return (
            <>
                <PopupOverlay onClick={onClose} />
                <VolumePopupContainer x={x} y={y}>
                    <VolumeLabel>{name}</VolumeLabel>
                    <VolumeSliderRow>
                        <VolumeSlider
                            type="range"
                            min="0"
                            max="100"
                            value={percent}
                            onInput={(e: any) => {
                                const val =
                                    parseInt(e.target.value, 10) / 100;
                                voiceState.setUserVolume(identity, val);
                            }}
                        />
                        <VolumePercent>{percent}%</VolumePercent>
                    </VolumeSliderRow>
                </VolumePopupContainer>
            </>
        );
    },
);

export default observer(() => {
    const connected = voiceState.status === VoiceStatus.CONNECTED;
    const connecting =
        voiceState.status === VoiceStatus.CONNECTING ||
        voiceState.status === VoiceStatus.RTC_CONNECTING;

    const [showSettings, setShowSettings] = useState(false);
    const [volumePopup, setVolumePopup] = useState<{
        identity: string;
        name: string;
        x: number;
        y: number;
    } | null>(null);

    const handleContextMenu = useCallback(
        (e: MouseEvent, identity: string, name: string) => {
            // Don't show volume popup for local participant
            if (identity === voiceState.localIdentity) return;
            e.preventDefault();
            setVolumePopup({ identity, name, x: e.clientX, y: e.clientY });
        },
        [],
    );

    if (connected) {
        const entries = Array.from(voiceState.participantNames.entries());

        return (
            <PanelBase>
                <ConnectedPanel>
                    <RoomLabel>
                        <Volume size={16} />
                        {voiceState.roomName}
                    </RoomLabel>
                    {entries.length > 0 && (
                        <ParticipantList>
                            {entries.map(([identity, name], i) => {
                                const speaking =
                                    voiceState.speakingParticipants.get(
                                        identity,
                                    ) ?? false;
                                const quality =
                                    voiceState.connectionQualities.get(
                                        identity,
                                    );

                                return (
                                    <ParticipantName
                                        key={identity}
                                        speaking={speaking}
                                        onContextMenu={(e: MouseEvent) =>
                                            handleContextMenu(
                                                e,
                                                identity,
                                                name,
                                            )
                                        }>
                                        <QualityDot quality={quality} />
                                        {name}
                                        {i < entries.length - 1 ? "," : ""}
                                        {i < entries.length - 1 ? "\u00A0" : ""}
                                    </ParticipantName>
                                );
                            })}
                        </ParticipantList>
                    )}
                    <Controls>
                        <ControlButton
                            danger
                            onClick={voiceState.disconnect}
                            title="Leave">
                            <PhoneOff />
                        </ControlButton>
                        {voiceState.isProducing("audio") ? (
                            <ControlButton
                                onClick={() =>
                                    voiceState.stopProducing("audio")
                                }
                                title="Mute">
                                <Microphone />
                            </ControlButton>
                        ) : (
                            <ControlButton
                                active
                                onClick={() =>
                                    voiceState.startProducing("audio")
                                }
                                title="Unmute">
                                <MicrophoneOff />
                            </ControlButton>
                        )}
                        {voiceState.isDeaf() ? (
                            <ControlButton
                                active
                                onClick={() => voiceState.stopDeafen()}
                                title="Undeafen">
                                <VolumeMute />
                            </ControlButton>
                        ) : (
                            <ControlButton
                                onClick={() => voiceState.startDeafen()}
                                title="Deafen">
                                <VolumeFull />
                            </ControlButton>
                        )}
                        <ControlButton
                            onClick={() => setShowSettings(!showSettings)}
                            title="Voice Settings"
                            active={showSettings}>
                            <Cog />
                        </ControlButton>
                    </Controls>
                    {showSettings && (
                        <SettingsPopup
                            onClose={() => setShowSettings(false)}
                        />
                    )}
                    {volumePopup && (
                        <VolumePopup
                            identity={volumePopup.identity}
                            name={volumePopup.name}
                            x={volumePopup.x}
                            y={volumePopup.y}
                            onClose={() => setVolumePopup(null)}
                        />
                    )}
                </ConnectedPanel>
            </PanelBase>
        );
    }

    return (
        <PanelBase>
            <Category>Voice Rooms</Category>
            {VOICE_ROOMS.map((room) => {
                const count = voiceState.participantCounts.get(room.id) ?? 0;
                const members =
                    voiceState.roomParticipants.get(room.id) ?? [];
                const isConnecting = connecting && voiceState.roomId === room.id;

                return (
                    <div key={room.id}>
                        <RoomButton
                            onClick={() =>
                                !connecting && voiceState.connect(room.id)
                            }>
                            <Volume size={16} />
                            {isConnecting ? "Connecting..." : room.name}
                            {count > 0 && (
                                <span className="count">({count})</span>
                            )}
                        </RoomButton>
                        {members.length > 0 && (
                            <RoomMembers>
                                {members.map((m) => m.name).join(", ")}
                            </RoomMembers>
                        )}
                    </div>
                );
            })}
        </PanelBase>
    );
});
