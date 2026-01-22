
import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { 
    generateRevisedImage, 
    generateRejuvenatedPrompt, 
    createCharacterBible,
    analyzeSceneImage,
    identifyConsistentCharacter
} from './services/geminiService';
import Button from './components/Button';

type SourceImage = { fileName: string; base64: string; mimeType: string };
type TextFile = { name: string; content: string };

const App: React.FC = () => {
    // State management
    const [status, setStatus] = useState('AWAITING ZIP');
    const [isReady, setIsReady] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState('');
    
    // Data Storage
    const [avatars, setAvatars] = useState<Record<string, SourceImage>>({});
    const [processedImages, setProcessedImages] = useState<Record<string, SourceImage>>({});
    const [textFiles, setTextFiles] = useState<TextFile[]>([]);
    const [fullScript, setFullScript] = useState<TextFile | null>(null);
    const [storyMap, setStoryMap] = useState<TextFile | null>(null);
    const [style, setStyle] = useState("very black backgrounds, very vibrant colors.");
    const characterBibleRef = useRef<string>(''); // Use ref to avoid re-renders

    const stopSignal = useRef(false);
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Effect to scroll logs to the bottom
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    const downloadBlob = (blob: Blob, filename: string) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    };

    const resetState = () => {
        setStatus('AWAITING ZIP');
        setIsReady(false);
        setIsProcessing(false);
        setLogs([]);
        setProgress('');
        setAvatars({});
        setProcessedImages({});
        setTextFiles([]);
        setFullScript(null);
        setStoryMap(null);
        characterBibleRef.current = '';
    }

    const recursiveUnzip = async (zipData: ArrayBuffer | Blob): Promise<{ images: Record<string, SourceImage>, texts: TextFile[] }> => {
        const zip = await JSZip.loadAsync(zipData);
        let extractedImages: Record<string, SourceImage> = {};
        let extractedTexts: TextFile[] = [];

        for (const name in zip.files) {
            const entry = zip.files[name];
            if (entry.dir) continue;

            const ext = name.toLowerCase().split('.').pop() || '';
            if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
                const base64 = await entry.async('base64');
                const mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                extractedImages[name] = { fileName: name, base64, mimeType: mime };
            } else if (['txt', 'md'].includes(ext)) {
                const content = await entry.async('string');
                extractedTexts.push({ name: name, content });
            }
        }
        return { images: extractedImages, texts: extractedTexts };
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        const currentTarget = e.currentTarget;

        resetState();
        setStatus('UPLOADING...');
        addLog(`Archive detected. Processing ${files.length} file(s)...`);

        try {
            let allImages: Record<string, SourceImage> = {};
            let allTexts: TextFile[] = [];

            // Step 1: Extract all content from all provided ZIP files.
            for (const file of files) {
                const data = await file.arrayBuffer();
                const extracted = await recursiveUnzip(data);
                allImages = { ...allImages, ...extracted.images };
                allTexts = [...allTexts, ...extracted.texts];
            }
            addLog(`Extracted ${Object.keys(allImages).length} total images and ${allTexts.length} text files.`);

            // Step 2: Classify the extracted files based on their paths/names.
            const tempAvatars: Record<string, SourceImage> = {};
            const tempProcessed: Record<string, SourceImage> = {};
            for (const path in allImages) {
                if (path.toLowerCase().includes('avatar')) {
                    tempAvatars[path] = allImages[path];
                } else {
                    tempProcessed[path] = allImages[path];
                }
            }
            addLog(`Classified ${Object.keys(tempAvatars).length} avatars and ${Object.keys(tempProcessed).length} scene images.`);

            // Step 3: Find key text files and set state.
            const script = allTexts.find(t => t.name.toLowerCase().includes('full'));
            const story = allTexts.find(t => t.name.toLowerCase().includes('story'));
            const globalStyle = allTexts.find(t => t.name.toLowerCase().includes('style'));
            
            if (globalStyle) setStyle(globalStyle.content);
            if (story) setStoryMap(story);

            setAvatars(tempAvatars);
            setProcessedImages(tempProcessed);
            setTextFiles(allTexts);
            setFullScript(script || null);
            
            if (!script) {
                addLog("WARNING: No 'full' script file found. Character Bible cannot be generated.");
            }

            addLog(`Extraction complete. ${Object.keys(tempProcessed).length} frames ready for processing.`);
            setIsReady(true);
            setStatus('READY FOR PRODUCTION');
        } catch (err: any) {
            addLog(`UPLOAD FAILED: ${err.message || 'Please ensure you are uploading valid ZIP archives.'}`);
            setStatus('ERROR');
        } finally {
            // Reset file input to allow re-uploading the same file(s)
            if (currentTarget) {
                currentTarget.value = '';
            }
        }
    };

    const runProcess = async (isTest: boolean) => {
        if (isProcessing) return;

        setIsProcessing(true);
        stopSignal.current = false;
        
        try {
            addLog(`--- ${isTest ? "TEST RUN (4 FRAMES)" : "FULL PRODUCTION"} INITIATED ---`);
            setStatus(isTest ? 'TESTING...' : 'PROCESSING...');

            // Step 1: Generate Character Bible on-demand
            if (fullScript && Object.keys(avatars).length > 0) {
                addLog("Generating Character Bible from script...");
                try {
                    const bible = await createCharacterBible(Object.keys(avatars), fullScript.content);
                    characterBibleRef.current = bible;
                    addLog("Character Bible successfully generated.");
                } catch (err: any) {
                    addLog(`CRITICAL ERROR: Failed to generate Character Bible: ${err.message}. Halting process.`);
                    setIsProcessing(false);
                    setStatus('READY FOR PRODUCTION');
                    return;
                }
            } else {
                addLog("WARNING: Cannot generate Character Bible. Missing full script or avatars.");
            }

            const images: SourceImage[] = Object.values(processedImages);
            const items: SourceImage[] = isTest ? images.slice(0, 4) : images;

            if (items.length === 0) {
                addLog("PROCESS HALTED: No images found in the queue.");
                setIsProcessing(false);
                setStatus('READY FOR PRODUCTION');
                return;
            }

            for (let i = 0; i < items.length; i++) {
                if (stopSignal.current) {
                    addLog("PROCESS ABORTED BY USER.");
                    break;
                }

                const img: SourceImage = items[i];
                setProgress(`[${i + 1}/${items.length}] ${img.fileName}`);

                try {
                    const base = img.fileName.split('.').shift() || "frame";
                    const tFile = textFiles.find(t => t.name.startsWith(base) && t.name.endsWith('.txt'));
                    if (!tFile) {
                        addLog(`SKIPPED: Missing .txt for ${img.fileName}`);
                        continue;
                    }

                    const sceneTextSnippet = tFile.content.split('\n').slice(3).join('\n');
                    
                    let scriptContext = "No context.";
                    if (fullScript) {
                        const searchStr = sceneTextSnippet.substring(0, Math.min(sceneTextSnippet.length, 50));
                        const idx = fullScript.content.indexOf(searchStr);
                        if (idx !== -1) {
                            scriptContext = fullScript.content.substring(Math.max(0, idx - 500), Math.min(fullScript.content.length, idx + 1500));
                        }
                    }

                    const visualAnalysis = await analyzeSceneImage(img.base64, img.mimeType);
                    const mapping = await identifyConsistentCharacter(sceneTextSnippet, visualAnalysis, characterBibleRef.current);
                    const avatar = mapping.avatarFilename ? avatars[mapping.avatarFilename] : null;

                    const rejuvenationPrompt = await generateRejuvenatedPrompt(
                        sceneTextSnippet, mapping.characterName, mapping.otherCharacters || [], characterBibleRef.current, 
                        style, visualAnalysis, scriptContext, storyMap?.content || null
                    );
                    
                    const gen = await generateRevisedImage(rejuvenationPrompt, avatar?.base64 || null, avatar?.mimeType || null, img.base64, img.mimeType);

                    if (gen.imageBase64) {
                        const byteString = atob(gen.imageBase64);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let n = 0; n < byteString.length; n++) ia[n] = byteString.charCodeAt(n);
                        const blob = new Blob([ab], { type: 'image/png' });
                        
                        downloadBlob(blob, `${base}_rejuvenated.png`);
                        addLog(`SUCCESS: ${img.fileName} downloaded.`);
                    } else {
                        addLog(`FAILED: No image generated for ${img.fileName}`);
                    }
                } catch (err: any) {
                    addLog(`ERROR on ${img.fileName}: ${err.message || 'Unknown error'}`);
                }
            }
        } catch (globalErr: any) {
            addLog(`A CRITICAL ERROR occurred: ${globalErr.message || globalErr}`);
        } finally {
            setIsProcessing(false);
            setProgress('');
            setStatus('READY FOR PRODUCTION');
            addLog(`--- ${isTest ? "TEST RUN" : "FULL PRODUCTION"} COMPLETED ---`);
        }
    };

    return (
        <div className="min-h-screen bg-black text-slate-100 font-mono flex flex-col h-screen overflow-hidden">
            <header className="flex-none border-b border-red-900 bg-zinc-950 p-4 flex justify-between items-center">
                <h1 className="text-2xl font-black text-red-600 italic tracking-tighter uppercase">Ben Shapeshiftiro</h1>
                <div className="bg-zinc-900 px-3 py-1 border border-red-900/40">
                    <span className="text-xs font-bold uppercase text-red-500">{isProcessing ? progress : status}</span>
                </div>
            </header>

            <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden">
                {/* CONTROL PANEL */}
                <div className="bg-zinc-950 border border-red-900/30 rounded-md p-6 flex flex-col gap-6">
                    <h2 className="text-xs font-bold text-red-500 uppercase tracking-widest">1. Input</h2>
                    <div className="relative border-2 border-dashed border-zinc-700 p-10 text-center bg-black hover:border-red-600 transition-colors group">
                        <input 
                            type="file" 
                            multiple 
                            accept=".zip"
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            onChange={handleUpload}
                            disabled={isProcessing}
                        />
                        <p className="text-3xl mb-2 group-hover:scale-110 transition-transform">📁</p>
                        <p className="text-[10px] font-bold text-zinc-400 uppercase">
                            {isReady ? "DRAG NEW ZIP TO RESET" : "DRAG & DROP PRODUCTION ZIP(S)"}
                        </p>
                    </div>

                    <h2 className="text-xs font-bold text-red-500 uppercase tracking-widest">2. Execute</h2>
                    {!isProcessing ? (
                        <div className="grid grid-cols-2 gap-4">
                            <Button onClick={() => runProcess(true)} disabled={!isReady}>Test (4 Frames)</Button>
                            <Button onClick={() => runProcess(false)} disabled={!isReady} className="bg-green-600 hover:bg-green-700">Full Production</Button>
                        </div>
                    ) : (
                        <Button onClick={() => { stopSignal.current = true; }} className="w-full bg-yellow-500 text-black hover:bg-yellow-400">
                            ABORT CURRENT TASK
                        </Button>
                    )}
                </div>

                {/* LOGS */}
                <div className="bg-zinc-950 border border-red-900/30 rounded-md flex flex-col h-full max-h-full overflow-hidden">
                    <div className="flex-none bg-zinc-900 px-4 py-2 text-[10px] font-bold text-red-600 uppercase border-b border-red-900/20">
                        System Log
                    </div>
                    <div ref={logContainerRef} className="flex-1 p-4 overflow-y-auto space-y-2 font-mono text-[11px] bg-black">
                        {logs.map((log, i) => (
                            <div key={i} className={`whitespace-pre-wrap ${log.includes('SUCCESS') ? 'text-green-500' : log.includes('ERROR') || log.includes('FAILED') || log.includes('CRITICAL') ? 'text-red-500' : 'text-zinc-500'}`}>
                                {log}
                            </div>
                        ))}
                        {logs.length === 0 && <div className="text-zinc-700">Waiting for data...</div>}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
