
import { GoogleGenAI, Type } from "@google/genai";

/**
 * Creates a comprehensive "Character Bible" by analyzing the full script and avatar metadata.
 */
export async function createCharacterBible(filenames: string[], fullScript: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `I am producing a film. I have a list of avatar filenames and a full movie script.
    
    AVATAR FILENAMES: ${filenames.join(', ')}
    
    SCRIPT CONTENT:
    ${fullScript.substring(0, 10000)}
    
    TASK:
    1. Create a "Character Bible". For each major character in the script, describe their personality, key visual traits, and typical dialogue style.
    2. Match each avatar filename to a specific character from the script. Explain the reasoning for the match.
    3. If a filename doesn't clearly match a character, flag it as a "Generic" or "Support" asset.
    
    Output this as a clear, structured report for my production team.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
        });
        return response.text || "Character Bible generation failed.";
    } catch (error) {
        console.error("Error creating Bible:", error);
        if (error instanceof Error) {
            throw new Error(`Error creating Bible: ${error.message}`);
        }
        throw new Error("An unknown error occurred while creating the Character Bible.");
    }
}

/**
 * Analyzes the visual content of a rough draft scene image.
 */
export async function analyzeSceneImage(base64: string, mimeType: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = "Describe the subject, composition, and lighting of this rough draft film frame. Is it black and white? Identify if there is a person, their pose, and the environment.";
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: {
                parts: [
                    { inlineData: { data: base64, mimeType } },
                    { text: prompt }
                ]
            }
        });
        return response.text || "Visual analysis unavailable.";
    } catch (error) {
        console.error("Image analysis failed:", error);
        if (error instanceof Error) {
            throw new Error(`Image analysis failed: ${error.message}`);
        }
        throw new Error("An unknown error occurred during image analysis.");
    }
}

/**
 * Maps the identified scene subject to the character bible and consistent avatar.
 */
export async function identifyConsistentCharacter(
    sceneText: string, 
    sceneVisualAnalysis: string, 
    characterBible: string
): Promise<{ characterName: string; avatarFilename: string | null; otherCharacters?: string[] }> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Based on the Character Bible and the Scene data below, identify who the characters in this specific frame are supposed to be.
    
    SCENE DIALOGUE/ACTION: "${sceneText}"
    SCENE VISUAL ANALYSIS: "${sceneVisualAnalysis}"
    
    CHARACTER BIBLE:
    ${characterBible.substring(0, 5000)}
    
    Return a JSON object identifying the character and the matching avatar filename.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        characterName: { type: Type.STRING, description: "The name of the primary character from the script." },
                        avatarFilename: { type: Type.STRING, description: "The matching avatar filename.", nullable: true },
                        otherCharacters: { 
                            type: Type.ARRAY, 
                            items: { type: Type.STRING },
                            description: "Other characters in the scene."
                        },
                        reasoning: { type: Type.STRING, description: "Matching logic." }
                    },
                    required: ["characterName", "avatarFilename", "otherCharacters", "reasoning"],
                }
            }
        });
        const result = JSON.parse(response.text || '{}');
        return { 
            characterName: result.characterName || "Unknown", 
            avatarFilename: result.avatarFilename || null,
            otherCharacters: result.otherCharacters || []
        };
    } catch (error) {
        console.error("Character identification failed:", error);
        if (error instanceof Error) {
            throw new Error(`Character identification failed: ${error.message}`);
        }
        throw new Error("An unknown error occurred during character identification.");
    }
}

/**
 * Generates the final rejuvenation prompt using the bible, context, and visual gap analysis.
 */
export async function generateRejuvenatedPrompt(
    sceneText: string, 
    characterName: string, 
    otherCharacters: string[],
    bible: string, 
    style: string,
    visualAnalysis: string,
    fullScriptSnippet: string,
    storyMap: string | null
): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Task: Draft a cinematic visual rejuvenation prompt for a film frame.

    --- NARRATIVE DATA ---
    [STORY MAP / PLOT POINTS]: 
    ${storyMap || "No story map provided. Infer plot progression from transcript."}

    [TRANSCRIPT SNIPPET (RAW DIALOGUE)]:
    ${sceneText}

    [TRANSCRIPT CONTEXT]:
    ${fullScriptSnippet}

    --- PRODUCTION ASSETS ---
    [TARGET CHARACTER]: ${characterName}
    [OTHER CHARACTERS]: ${otherCharacters.join(', ')}
    [CHARACTER BIBLE]: ${bible.substring(0, 500)}
    [CURRENT FRAME VISUALS]: ${visualAnalysis}
    [STYLE OVERRIDE]: ${style}
    
    --- CINEMATIC INFERENCE RULES ---
    1. INFER PERFORMANCE: The transcript lacks stage directions. Based on dialogue, ideate the character's EMOTION and PHYSICAL POSTURE.
    2. FORCE COLOR: If the source is Black and White, the prompt MUST request vibrant, cinematic color.
    3. CAMERA LOGIC: Suggest a professional angle (e.g., "tight low-angle", "Dutch tilt", "extreme close-up").
    4. FOCUS: Incorporate specific traits from the Character Bible for ${characterName}.

    Output a single cinematic prompt (max 60 words) describing the lighting, performance, and composition.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
        });
        return response.text?.trim() || "Cinematic film frame, professional lighting, detailed characters.";
    } catch (error) {
        console.error("Prompt generation failed:", error);
        if (error instanceof Error) {
            throw new Error(`Prompt generation failed: ${error.message}`);
        }
        throw new Error("An unknown error occurred during prompt generation.");
    }
}

/**
 * Core revision: Subject replacement with consistency.
 */
export async function generateRevisedImage(
    prompt: string,
    avatarBase64: string | null,
    avatarMime: string | null,
    sceneBase64: string,
    sceneMime: string,
    aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' = '16:9'
): Promise<{ imageBase64: string | null }> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const parts: (string | { inlineData: { data: string; mimeType: string; } } | { text: string; })[] = [];
    
    let instructionText = `**PRIMARY GOAL:** Generate a new, high-quality, cinematic image based on the following detailed prompt.\n**PROMPT:** ${prompt}\n`;

    if (avatarBase64 && avatarMime) {
        instructionText += `**REFERENCE AVATAR:** Use the provided avatar image as a strong reference for the character's appearance, integrating them into the scene.\n`;
        parts.push({ inlineData: { data: avatarBase64, mimeType: avatarMime } });
    }

    instructionText += `**REFERENCE SCENE:** Use the provided scene image for composition, lighting, and environmental context. Replace or modify characters as needed to match the avatar and prompt.`;
    parts.push({ inlineData: { data: sceneBase64, mimeType: sceneMime } });
    parts.unshift({ text: instructionText });

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: { parts: parts },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio,
                },
            },
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return { imageBase64: part.inlineData.data };
            }
        }
        return { imageBase64: null };

    } catch (error) {
        console.error("Image revision failed:", error);
        if (error instanceof Error) {
            throw new Error(`Image revision failed: ${error.message}`);
        }
        throw new Error("An unknown error occurred during image revision.");
    }
}
