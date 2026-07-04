import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: Request) {
  try {
    const { history, answer, resumeText, jobDescription, applicantName, userApiKey } = await req.json();

    const key = userApiKey || process.env.API || process.env.GEMINI_API_KEY;
    if (!key) {
       return NextResponse.json({ success: false, error: 'No API key provided.' }, { status: 400 });
    }
    
    const ai = new GoogleGenAI({ apiKey: key });

    if (!answer || !resumeText) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const applicant = applicantName || 'the applicant';

    // Construct the prompt for the next question/feedback
    // history should be an array of objects: { role: 'user' | 'model', text: string }
    
    // Truncate history to the last 4 messages to save processing time
    let recentHistory = history || [];
    if (recentHistory.length > 4) {
      recentHistory = recentHistory.slice(-4);
    }
    
    let conversationHistory = "";
    if (recentHistory.length > 0) {
      conversationHistory = recentHistory.map((msg: any) => `${msg.role === 'user' ? applicant : 'AI_Interviewer'}: ${msg.text}`).join('\n');
    }

    const prompt = `You are an expert technical interviewer named AI_Interviewer conducting a lightning-fast voice interview with ${applicant}.
    
    ${jobDescription ? `Job Context:\n${jobDescription}\n` : ''}
    Resume Summary:
    ${resumeText.substring(0, 2500)}
    
    Recent Conversation:
    ${conversationHistory}
    
    ${applicant}'s latest answer:
    ${answer}
    
    Task:
    Acknowledge the answer very briefly and ask ONE highly relevant follow-up question.
    CRITICAL RULES:
    - Keep your entire response under 2 short sentences.
    - NEVER use markdown, formatting, or bullet points.
    - Speak directly, naturally, and fast.`;

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: prompt,
      config: {
        maxOutputTokens: 100,
        temperature: 0.7,
      }
    });
    
    const reply = response.text || `Thank you, ${applicant}. What would you say is your greatest technical strength?`;
    
    return NextResponse.json({ 
      success: true, 
      reply: reply
    });

  } catch (error: any) {
    console.error('Error generating reply:', error);
    return NextResponse.json({ error: error.message || 'Error processing request' }, { status: 500 });
  }
}
