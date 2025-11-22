import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob, Type } from '@google/genai';
import type { TranscriptEntry } from './types';

// --- Audio Helper Functions ---

// Decodes a base64 string into a Uint8Array.
const decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Encodes a Uint8Array into a base64 string.
const encode = (bytes: Uint8Array): string => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};


// Decodes raw PCM audio data into an AudioBuffer for playback.
const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

// Creates a Gemini API Blob from microphone Float32Array data.
const createBlob = (data: Float32Array): Blob => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
};

// --- Constants ---

const LANGUAGES = {
    "English": "en-US", "Spanish": "es-ES", "French": "fr-FR", "German": "de-DE", 
    "Italian": "it-IT", "Japanese": "ja-JP", "Korean": "ko-KR", "Portuguese": "pt-BR",
    "Russian": "ru-RU", "Chinese (Mandarin)": "cmn-CN"
};

// --- Settings Types & Logic ---
interface AppSettings {
    theme: 'light' | 'dark';
    volume: number;
    playbackRate: number;
}

const getInitialSettings = (): AppSettings => {
    try {
        const savedSettings = localStorage.getItem('echoLinguaSettings');
        if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            return {
                theme: parsed.theme === 'dark' ? 'dark' : 'light',
                volume: typeof parsed.volume === 'number' ? parsed.volume : 1,
                playbackRate: typeof parsed.playbackRate === 'number' ? parsed.playbackRate : 1,
            };
        }
    } catch (error) {
        console.error("Could not parse settings from localStorage, using defaults.", error);
    }
    
    const prefersDarkMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return { 
        theme: prefersDarkMode ? 'dark' : 'light', 
        volume: 1, 
        playbackRate: 1 
    };
};


// --- Neumorphic UI Components ---

interface NeumorphicCardProps {
  children: React.ReactNode;
  className?: string;
}
const NeumorphicCard: React.FC<NeumorphicCardProps> = ({ children, className = '' }) => (
  <div className={`bg-neutral-100 dark:bg-neutral-800 rounded-2xl shadow-[7px_7px_15px_#d4d4d4,_-7px_-7px_15px_#ffffff] dark:shadow-[7px_7px_15px_#171717,_-7px_-7px_15px_#404040] p-4 ${className}`}>
    {children}
  </div>
);

interface NeumorphicButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  isActive?: boolean;
}
const NeumorphicButton: React.FC<NeumorphicButtonProps> = ({ children, isActive = false, className = '', ...props }) => {
  const baseClasses = "transition-all duration-200 ease-in-out rounded-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-100 dark:focus:ring-offset-neutral-900 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95";
  const activeClasses = "shadow-[inset_4px_4px_8px_#a3a3a3,_inset_-4px_-4px_8px_#ffffff] dark:shadow-[inset_4px_4px_8px_#171717,_inset_-4px_-4px_8px_#404040] text-blue-600 dark:text-blue-400";
  const inactiveClasses = "shadow-[5px_5px_10px_#a3a3a3,_-5px_-5px_10px_#ffffff] dark:shadow-[5px_5px_10px_#171717,_-5px_-5px_10px_#404040] text-neutral-700 dark:text-neutral-300 hover:text-blue-500 dark:hover:text-blue-400";
  
  return (
    <button className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses} ${className}`} {...props}>
      {children}
    </button>
  );
};

// --- Text Practice Component (Writing Lab) ---

interface AnalysisResult {
    correctedText: string;
    explanation: string;
    phonetics: string;
}

interface TextPracticeViewProps {
    textToSpeak: string;
    setTextToSpeak: React.Dispatch<React.SetStateAction<string>>;
    settings: AppSettings;
}

const TextPracticeView: React.FC<TextPracticeViewProps> = ({ textToSpeak, setTextToSpeak, settings }) => {
    const [language, setLanguage] = useState('English');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        setAnalysis(null);
    }, [textToSpeak]);

    const handleAnalyze = async () => {
        if (!textToSpeak.trim()) return;
        setIsAnalyzing(true);
        setAnalysis(null);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            const prompt = `Act as an expert language tutor. The user is practicing writing in ${language}.
            Analyze their input: "${textToSpeak}".
            
            Your tasks:
            1. Correct any grammar, spelling, vocabulary, or naturalness errors. If the input is perfect, return it as is.
            2. Provide a concise, helpful explanation of your corrections (in English). If no corrections, compliment their writing.
            3. Provide the International Phonetic Alphabet (IPA) transcription of the *corrected* text.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            correctedText: { type: Type.STRING },
                            explanation: { type: Type.STRING },
                            phonetics: { type: Type.STRING },
                        },
                        required: ["correctedText", "explanation", "phonetics"],
                    },
                },
            });

            const resultText = response.text;
            if (resultText) {
                setAnalysis(JSON.parse(resultText));
            }
        } catch (error) {
            console.error("Analysis failed:", error);
            alert("Sorry, I couldn't analyze the text right now.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSpeak = async (textToRead: string) => {
        if (!textToRead.trim() || isSpeaking) return;

        setIsSpeaking(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-tts',
                contents: [{ parts: [{ text: textToRead }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' },
                        },
                    },
                },
            });
            
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                }
                const audioCtx = audioContextRef.current;
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
                
                const gainNode = audioCtx.createGain();
                gainNode.gain.value = settings.volume;

                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.playbackRate.value = settings.playbackRate;

                source.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                source.start();
                source.onended = () => setIsSpeaking(false);
            } else {
              setIsSpeaking(false);
            }
        } catch (error) {
            console.error("TTS Error:", error);
            alert("Sorry, I couldn't generate the speech for that text.");
            setIsSpeaking(false);
        }
    };
    
    return (
        <div className="h-full flex flex-col relative">
             {/* Scrollable Content Area */}
             <div className="flex-grow overflow-y-auto px-4 py-6 pb-48 space-y-6">
                <div className="flex flex-col space-y-2">
                    <label className="text-sm font-medium text-neutral-600 dark:text-neutral-300 ml-2">Your Draft</label>
                    <textarea
                        value={textToSpeak}
                        onChange={(e) => setTextToSpeak(e.target.value)}
                        className="w-full h-40 p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-[inset_5px_5px_10px_#a3a3a3,_inset_-5px_-5px_10px_#ffffff] dark:shadow-[inset_5px_5px_10px_#171717,_inset_-5px_-5px_10px_#404040] text-lg resize-none"
                        placeholder={`Type in ${language}...`}
                    />
                </div>

                {(analysis || isAnalyzing) && (
                    <NeumorphicCard className="animate-in fade-in slide-in-from-bottom-4 duration-500 mb-20">
                        {isAnalyzing ? (
                             <div className="h-20 flex items-center justify-center space-x-2 text-neutral-500">
                                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            </div>
                        ) : analysis && (
                            <div className="space-y-6">
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Corrected</label>
                                        <NeumorphicButton 
                                            onClick={() => handleSpeak(analysis.correctedText)} 
                                            disabled={isSpeaking}
                                            className="w-10 h-10 flex items-center justify-center !rounded-full"
                                        >
                                             {isSpeaking ? (
                                                <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </NeumorphicButton>
                                    </div>
                                    <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 text-lg text-neutral-800 dark:text-neutral-100 font-medium">
                                        {analysis.correctedText}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1 block">Phonetics</label>
                                    <div className="font-mono text-sm text-neutral-600 dark:text-neutral-300 bg-neutral-200/50 dark:bg-neutral-700/50 p-2 rounded-lg">
                                        {analysis.phonetics}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1 block">Notes</label>
                                    <p className="text-neutral-700 dark:text-neutral-300 text-sm italic">"{analysis.explanation}"</p>
                                </div>
                            </div>
                        )}
                    </NeumorphicCard>
                )}
            </div>

            {/* Thumb Controls - Fixed Bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-4 pb-6 bg-neutral-100/90 dark:bg-neutral-900/90 backdrop-blur-md border-t border-neutral-200 dark:border-neutral-800 flex flex-col space-y-3 z-20">
                 <div className="flex items-center space-x-3">
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="flex-1 p-3 rounded-xl bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 focus:outline-none shadow-[inset_2px_2px_5px_#a3a3a3,_inset_-2px_-2px_5px_#ffffff] dark:shadow-[inset_2px_2px_5px_#171717,_inset_-2px_-2px_5px_#404040]"
                    >
                            {Object.keys(LANGUAGES).map(lang => <option key={lang} value={lang}>{lang}</option>)}
                    </select>
                    <NeumorphicButton 
                        onClick={handleAnalyze} 
                        disabled={isAnalyzing || !textToSpeak.trim()} 
                        className="flex-1 py-3 bg-blue-50 dark:bg-neutral-700 text-blue-600 dark:text-blue-400"
                    >
                        {isAnalyzing ? 'Analyzing...' : 'Review'}
                    </NeumorphicButton>
                </div>
            </div>
        </div>
    );
};


// --- Translation Component ---

interface TranslationViewProps {
    settings: AppSettings;
}

const TranslationView: React.FC<TranslationViewProps> = ({ settings }) => {
    const [lang1, setLang1] = useState('English');
    const [lang2, setLang2] = useState('Spanish');
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
    const [interimTranscript, setInterimTranscript] = useState('');

    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const microphoneStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const currentTextRef = useRef('');
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [transcripts, interimTranscript]);

    const handleStopSession = useCallback(async () => {
        if (!sessionPromiseRef.current) return;

        try {
            const session = await sessionPromiseRef.current;
            session.close();
        } catch (error) {
            console.error("Error closing session:", error);
        } finally {
            microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
            scriptProcessorRef.current?.disconnect();
            inputAudioContextRef.current?.close();
            outputAudioContextRef.current?.close();

            sessionPromiseRef.current = null;
            microphoneStreamRef.current = null;
            scriptProcessorRef.current = null;
            inputAudioContextRef.current = null;
            outputAudioContextRef.current = null;
            
            setIsSessionActive(false);
        }
    }, []);

    const handleStartSession = useCallback(async () => {
        setIsSessionActive(true);
        setInterimTranscript('');
        currentTextRef.current = '';
        nextStartTimeRef.current = 0;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            microphoneStreamRef.current = stream;

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    systemInstruction: `You are a professional simultaneous interpreter. Your task is to listen to a conversation between a ${lang1} speaker and a ${lang2} speaker.
                    If you hear ${lang1}, translate it immediately to ${lang2}.
                    If you hear ${lang2}, translate it immediately to ${lang1}.
                    Do not answer the questions or participate in the conversation. Only act as the voice of the translator.
                    Keep your tone professional and match the emotion of the speaker.`,
                },
                callbacks: {
                    onopen: () => {
                        const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;

                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            if (sessionPromiseRef.current) {
                                sessionPromiseRef.current.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            }
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                             currentTextRef.current += message.serverContent.inputTranscription.text;
                             setInterimTranscript(currentTextRef.current);
                        }

                        if (message.serverContent?.turnComplete) {
                            const text = currentTextRef.current;
                            if (text.trim()) {
                                setTranscripts(prev => [...prev, { id: Date.now(), speaker: 'user', text }]);
                            }
                            currentTextRef.current = '';
                            setInterimTranscript('');
                        }

                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio) {
                            const audioCtx = outputAudioContextRef.current!;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
                            
                            const gainNode = audioCtx.createGain();
                            gainNode.gain.value = settings.volume;

                            const sourceNode = audioCtx.createBufferSource();
                            sourceNode.buffer = audioBuffer;
                            sourceNode.playbackRate.value = settings.playbackRate;
                            
                            sourceNode.connect(gainNode);
                            gainNode.connect(audioCtx.destination);
                            
                            sourceNode.addEventListener('ended', () => {
                                audioSourcesRef.current.delete(sourceNode);
                            });

                            sourceNode.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration / settings.playbackRate;
                            audioSourcesRef.current.add(sourceNode);
                        }
                        
                        if (message.serverContent?.interrupted) {
                            for(const source of audioSourcesRef.current.values()){
                                source.stop();
                                audioSourcesRef.current.delete(source);
                            }
                            nextStartTimeRef.current = 0;
                        }
                    },
                    onerror: (e) => {
                        console.error("Session error:", e);
                        handleStopSession();
                    },
                    onclose: () => {
                        console.log("Session closed.");
                    },
                },
            });

        } catch (error) {
            console.error("Failed to start session:", error);
            alert("Could not start microphone. Please check permissions.");
            setIsSessionActive(false);
        }
    }, [handleStopSession, settings, lang1, lang2]);

    useEffect(() => {
        return () => {
            if (isSessionActive) handleStopSession();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSessionActive]);

    return (
        <div className="h-full flex flex-col relative">
            {/* Main Chat Display */}
            <div ref={scrollRef} className="flex-grow overflow-y-auto px-4 pt-4 pb-48 space-y-4">
                {transcripts.length === 0 && !interimTranscript ? (
                     <div className="flex flex-col items-center justify-center h-64 opacity-50">
                        <p className="text-neutral-500 dark:text-neutral-400 text-center px-10">
                            Tap the microphone below to start the interpreter.
                        </p>
                     </div>
                ) : (
                    transcripts.map((item) => (
                        <div key={item.id} className="flex justify-start animate-in fade-in zoom-in-95 duration-300">
                             <NeumorphicCard className="max-w-[85%] !p-3 !rounded-xl !shadow-[2px_2px_5px_#d4d4d4,_-2px_-2px_5px_#ffffff] dark:!shadow-[2px_2px_5px_#171717,_-2px_-2px_5px_#404040]">
                                <p className="text-base font-medium text-neutral-800 dark:text-neutral-200">{item.text}</p>
                            </NeumorphicCard>
                        </div>
                    ))
                )}
                {interimTranscript && (
                    <div className="flex justify-start opacity-70">
                        <NeumorphicCard className="max-w-[85%] !p-3 !rounded-xl !bg-transparent !shadow-none border border-dashed border-neutral-300 dark:border-neutral-600">
                           <p className="text-base italic text-neutral-600 dark:text-neutral-400">{interimTranscript}...</p>
                       </NeumorphicCard>
                   </div>
                )}
            </div>

            {/* Thumb Control Deck - Fixed Bottom */}
            <div className="absolute bottom-0 left-0 right-0 px-6 py-6 bg-neutral-100/90 dark:bg-neutral-900/90 backdrop-blur-xl border-t border-neutral-200 dark:border-neutral-800 z-20 flex flex-col items-center space-y-5 rounded-t-3xl shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                 {/* Language Selectors */}
                 <div className="w-full flex items-center justify-between space-x-4">
                    <div className="flex-1 flex flex-col">
                        <label className="text-[10px] font-bold uppercase text-neutral-400 mb-1 ml-1">Speaker 1</label>
                        <select
                            value={lang1}
                            onChange={(e) => setLang1(e.target.value)}
                            disabled={isSessionActive}
                            className="w-full p-3 rounded-xl bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-sm font-bold focus:outline-none shadow-[inset_2px_2px_4px_#d4d4d4,_inset_-2px_-2px_4px_#ffffff] dark:shadow-[inset_2px_2px_4px_#171717,_inset_-2px_-2px_4px_#404040] appearance-none text-center"
                        >
                                {Object.keys(LANGUAGES).map(lang => <option key={lang} value={lang}>{lang}</option>)}
                        </select>
                    </div>
                    
                    <div className="text-neutral-400 pt-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                    </div>

                    <div className="flex-1 flex flex-col">
                        <label className="text-[10px] font-bold uppercase text-neutral-400 mb-1 ml-1">Speaker 2</label>
                        <select
                            value={lang2}
                            onChange={(e) => setLang2(e.target.value)}
                            disabled={isSessionActive}
                            className="w-full p-3 rounded-xl bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-sm font-bold focus:outline-none shadow-[inset_2px_2px_4px_#d4d4d4,_inset_-2px_-2px_4px_#ffffff] dark:shadow-[inset_2px_2px_4px_#171717,_inset_-2px_-2px_4px_#404040] appearance-none text-center"
                        >
                                {Object.keys(LANGUAGES).map(lang => <option key={lang} value={lang}>{lang}</option>)}
                        </select>
                    </div>
                </div>

                {/* Main Action Button */}
                 <NeumorphicButton 
                    onClick={isSessionActive ? handleStopSession : handleStartSession}
                    isActive={isSessionActive}
                    className={`w-24 h-24 flex items-center justify-center rounded-full transition-all duration-300 ${isSessionActive ? 'bg-red-50 dark:bg-red-900/20' : 'bg-neutral-100 dark:bg-neutral-800'}`}
                    aria-label={isSessionActive ? 'Stop interpreting' : 'Start interpreting'}
                >
                    {isSessionActive ? (
                        <div className="flex flex-col items-center space-y-2">
                             <div className="w-8 h-8 bg-red-500 rounded shadow-red-500/50 shadow-lg animate-pulse"></div>
                        </div>
                    ) : (
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                            <path d="M5.5 11.5a.5.5 0 01.5.5v1a4 4 0 004 4h0a4 4 0 004-4v-1a.5.5 0 011 0v1a5 5 0 01-4.5 4.975V19h3a.5.5 0 010 1h-7a.5.5 0 010-1h3v-1.525A5 5 0 014.5 13v-1a.5.5 0 01.5-.5z" />
                        </svg>
                    )}
                </NeumorphicButton>
            </div>
        </div>
    );
};

// --- Main App Component ---

const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'translate' | 'practice'>('translate');
    const [settings, setSettings] = useState<AppSettings>(getInitialSettings());
    
    // Practice State
    const [textToSpeak, setTextToSpeak] = useState('');

    useEffect(() => {
        document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    }, [settings.theme]);

    return (
        <div className="fixed inset-0 w-full h-full bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 overflow-hidden flex flex-col font-sans">
             {/* Minimal Header */}
             <header className="flex-shrink-0 px-6 py-4 flex justify-between items-center z-30 bg-neutral-100/80 dark:bg-neutral-900/80 backdrop-blur-sm">
                <h1 className="text-xl font-extrabold tracking-tight text-neutral-700 dark:text-neutral-200">
                    Echo<span className="text-blue-500">Lingua</span>
                </h1>
                <NeumorphicButton 
                    onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))}
                    className="w-10 h-10 flex items-center justify-center !rounded-full"
                >
                    {settings.theme === 'light' ? '🌙' : '☀️'}
                </NeumorphicButton>
            </header>

            <main className="flex-grow relative w-full max-w-lg mx-auto h-full">
                <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'translate' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <TranslationView settings={settings} />
                </div>
                <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'practice' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    <TextPracticeView textToSpeak={textToSpeak} setTextToSpeak={setTextToSpeak} settings={settings} />
                </div>
            </main>

            {/* Bottom Navigation - Anchored to very bottom */}
            <nav className="flex-shrink-0 pb-safe-area bg-neutral-100 dark:bg-neutral-900 z-50 border-t border-neutral-200 dark:border-neutral-800">
                <div className="flex justify-around items-center px-6 py-2 h-16">
                     <button
                        onClick={() => setActiveTab('translate')}
                        className={`flex flex-col items-center space-y-1 transition-colors duration-200 ${activeTab === 'translate' ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                        </svg>
                        <span className="text-[10px] font-bold uppercase tracking-wider">Interpreter</span>
                    </button>
                    
                    <button
                        onClick={() => setActiveTab('practice')}
                         className={`flex flex-col items-center space-y-1 transition-colors duration-200 ${activeTab === 'practice' ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400'}`}
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span className="text-[10px] font-bold uppercase tracking-wider">Writing Lab</span>
                    </button>
                </div>
            </nav>
        </div>
    );
};

export default App;