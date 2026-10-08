import { useState } from "react";
import { SessionConfig } from "@gd-arena/contracts";
import { RoomSetup } from "./components/RoomSetup";
import { LiveArena } from "./components/LiveArena";

type ActiveSession = {
  sessionId: string;
  config: SessionConfig;
};

export function App() {
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);

  return (
    <main className="shell">
      <header className="app-header">
        <h1>GD Arena</h1>
        <p className="lede">Practise a group discussion out loud, then see exactly which moments helped or hurt you.</p>
      </header>

      {activeSession ? (
        <LiveArena
          sessionId={activeSession.sessionId}
          config={activeSession.config}
          onStartNewSession={() => setActiveSession(null)}
        />
      ) : (
        <RoomSetup
          onSessionCreated={(session) => {
            setActiveSession({ sessionId: session.id, config: session.config });
          }}
        />
      )}
    </main>
  );
}


