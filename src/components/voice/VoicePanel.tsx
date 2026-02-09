import {
    Microphone,
    MicrophoneOff,
    PhoneOff,
    VolumeFull,
    VolumeMute,
} from "@styled-icons/boxicons-solid";
import { Volume } from "@styled-icons/boxicons-solid";
import { observer } from "mobx-react-lite";
import styled from "styled-components/macro";

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
    line-height: 1.4;
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

export default observer(() => {
    const connected = voiceState.status === VoiceStatus.CONNECTED;
    const connecting =
        voiceState.status === VoiceStatus.CONNECTING ||
        voiceState.status === VoiceStatus.RTC_CONNECTING;

    if (connected) {
        const names = Array.from(voiceState.participantNames.values());

        return (
            <PanelBase>
                <ConnectedPanel>
                    <RoomLabel>
                        <Volume size={16} />
                        {voiceState.roomName}
                    </RoomLabel>
                    {names.length > 0 && (
                        <ParticipantList>
                            {names.join(", ")}
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
                    </Controls>
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
