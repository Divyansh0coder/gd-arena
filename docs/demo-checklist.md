# Hackathon Live Demo Checklist

Use this checklist during live hackathon judging demonstrations to verify full system reliability.

## Pre-Demo Setup
- [ ] Environment variables configured (`GEMINI_API_KEY` or `GROQ_API_KEY` in `.env`).
- [ ] Server running on `http://localhost:8787` (`npm run dev:server`).
- [ ] Web client running on `http://localhost:3000` (`npm run dev:web`).

## Live Demo Flow Steps
- [ ] **1. Landing & Room Setup**: Open application on browser (`http://localhost:3000`), choose or enter a topic, select AI panel size, and click **Create GD Session**.
- [ ] **2. GD Session Start**: Room transitions from lobby to opening. AI Moderator introduces the session topic.
- [ ] **3. AI Discussion & Persona Turns**: Arjun, Meera, and Kabir take structured turns based on their unique personas.
- [ ] **4. Candidate Microphone Input**: Click **🎤 Start Speaking**, speak candidate turn out loud. Verify live interim preview and final transcript broadcast.
- [ ] **5. Candidate Interruption / Barge-in**: Speak out loud while an AI persona is speaking. Verify active AI speech stops immediately and lock releases.
- [ ] **6. Natural Turn-Taking**: After candidate turn ends, Turn Manager selects next AI persona to respond.
- [ ] **7. Closing Round**: Transition to closing phase; AI Moderator invites concluding statements.
- [ ] **8. Session Completion**: End GD session (timer or manual button). Verify microphone and AI TTS stop immediately.
- [ ] **9. Report Generation**: GD Performance Report loads, showing deterministic session metrics and 8 skill dimension scores.
- [ ] **10. Transcript Evidence**: Verify every feedback item quote is linking to an actual stored transcript segment. Click **Jump to transcript** to scroll & highlight.
- [ ] **11. Missed Opportunities**: Review up to 3 detected weak moments with AI suggestions.
- [ ] **12. Interactive Retry**: Click **[Try This Moment →]**, view context replay, and speak an improved response.
- [ ] **13. Original vs Retry Comparison**: Verify score improvement (+N points) and bullet points explaining what improved without changing the original report.
- [ ] **14. Demo Reset**: Click **Start New GD** to reset session state, transcript, active AI speaker, microphone, and report state completely.
