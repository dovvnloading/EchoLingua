
<div align="center">
  <br />
    <a href="https://github.com/google/genai-toolbox">
    <img src="https://img.shields.io/badge/ECHO-LINGUA-black?style=for-the-badge&logoColor=white&logo=googlecloud&labelColor=black&color=4285F4" alt="EchoLingua Logo" />
  </a>

  <h3 align="center">Real-Time AI Interpretation & Linguistics Lab</h3>

  <p align="center">
    Powered by Google Gemini 2.5 Flash & Gemini Live API
  </p>

  <!-- Badges -->
  <p align="center">
    <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
    <img src="https://img.shields.io/badge/Google_GenAI-8E75B2?style=for-the-badge&logo=google&logoColor=white" alt="Gemini" />
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License" />
  </p>
</div>

---

<img width="3168" height="1344" alt="Gemini_Generated_Image_k8cvagk8cvagk8cv" src="https://github.com/user-attachments/assets/4a4b4ceb-479a-4a30-9c40-3cad2a8431cf" />




---


## Overview

**EchoLingua AI** is a sophisticated web application engineered for real-time simultaneous interpretation and advanced linguistic analysis. By leveraging the low-latency capabilities of **Google's Gemini Live API**, the application bridges language barriers instantly while offering a dedicated writing lab for granular text critique.

The user experience is built upon a **"Thumb UI" philosophy**, anchoring critical controls to the bottom of the viewport for optimal one-handed mobile interaction, enveloped in a high-fidelity neumorphic design system that provides tactile feedback through soft shadows and highlights.

## Core Features

### Dual-Voice Interpreter
*   **Simultaneous Interpretation:** Connects to the Gemini Live API to process continuous audio streams, enabling instant speech translation between two selected languages.
*   **Bi-Directional Flow:** Eliminates the need for turn-taking toggles; both speakers may converse naturally while the AI handles directionality.
*   **Live Transcription:** Renders a real-time textual log of the conversation to aid visual comprehension.
*   **High-Fidelity Audio:** Processes raw PCM audio (16kHz input / 24kHz output) for broadcast-quality, low-latency performance.

### Writing & Pronunciation Lab
*   **Granular Analysis:** Submits user drafts to Gemini Flash for rigorous checks on grammar, spelling, and vocabulary usage.
*   **Schema-Enforced Feedback:** Returns structured data including error explanations and International Phonetic Alphabet (IPA) transcriptions via strict JSON schema enforcement.
*   **Neural TTS:** Integrates high-quality AI voice synthesis to demonstrate correct pronunciation of analyzed text.

### User Experience
*   **Neumorphic Architecture:** A visual design language utilizing realistic lighting physics to create depth and a soft, physical feel.
*   **Mobile-First Thumb UI:** Primary interaction points (microphones, language selectors, analysis triggers) are positioned within the natural reach of the user's thumb.
*   **System-Aware Dark Mode:** Fully responsive theming that adheres to system preferences or manual user overrides.

---

## Technical Stack

| Category | Technology | Details |
| :--- | :--- | :--- |
| **Frontend** | React 19 | Built with TypeScript for type safety. |
| **Styling** | Tailwind CSS | Utility-first styling framework. |
| **SDK** | Google GenAI SDK | `@google/genai` integration. |
| **Audio** | Web Audio API | `AudioContext` & `ScriptProcessorNode` for PCM stream manipulation. |

### Model Implementation

*   **Live Audio:** `gemini-2.5-flash-native-audio-preview-09-2025`
*   **Text Analysis:** `gemini-2.5-flash`
*   **Text-to-Speech:** `gemini-2.5-flash-preview-tts`

---

## Architecture & Audio Pipeline

EchoLingua manually orchestrates audio data to maintain strict compatibility with the Gemini Live API protocols.

### Audio Input
Microphone data is captured via `getUserMedia`, downsampled to **16kHz**, and converted into raw **PCM 16-bit integer** format. This stream is transmitted over WebSocket to the Live API.

### Audio Output
The model response includes base64-encoded PCM data. The frontend decodes this into a `Float32Array` format and schedules playback via the Web Audio API's `AudioBufferSourceNode`, ensuring a gapless auditory experience.

### State Management
*   **Live Session:** Utilizes `useRef` hooks to manage WebSocket connections and audio streams, preventing unnecessary React render cycles during high-frequency data transmission.
*   **Persistence:** User preferences, such as theme settings and volume levels, are serialized to `localStorage`.

---

## Prerequisites

Ensure the following are installed and configured before deployment:

1.  **Node.js**: Version 18 or higher.
2.  **Google Cloud Project**: A project with the Gemini API enabled.
3.  **API Key**: A valid Gemini API Key.

---

## Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd echolingua-ai
npm install
```

### Environment Configuration

Create a `.env` file in the root directory (or configure your build tool's environment variables) to store your sensitive credentials:

```properties
# .env
API_KEY=your_google_genai_api_key
```

### Development

Launch the local development server:

```bash
npm start
```

---

## Usage Guide

### Interpreter Mode
1.  Navigate to the **Interpreter** tab via the bottom navigation bar.
2.  Designate the two active languages using the bottom selectors.
3.  Activate the **Microphone** control to initialize the WebSocket connection with the Live API.
4.  Speak freely; the system will auto-detect the language and stream the translated audio response.
5.  Deactivate the microphone to terminate the session.

### Writing Lab
1.  Navigate to the **Writing Lab** tab.
2.  Select the target language from the dropdown menu.
3.  Input text into the drafting area.
4.  Select **Review** to trigger the Gemini Flash analysis.
5.  Review the returned corrections, IPA transcriptions, and tutor notes.
6.  Select the **Speaker** icon to audit the correct pronunciation via TTS.

---

## License

This project is distributed under the **MIT License**. See the `LICENSE` file for more information.
