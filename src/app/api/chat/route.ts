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
    
    let conversationHistory = "";
    if (history && history.length > 0) {
      conversationHistory = history.map((msg: any) => `${msg.role === 'user' ? applicant : 'AI_Interviewer'}: ${msg.text}`).join('\n');
    }

    const prompt = `You are an expert technical interviewer named AI_Interviewer conducting an interview with ${applicant}.
    
    ${jobDescription ? `Job Description / Role context:\n${jobDescription}\n` : ''}
    Resume Context:
    ${resumeText.substring(0, 5000)}
    
    Conversation History:
    ${conversationHistory}
    
    ${applicant}'s latest answer:
    ${answer}
    
    Task:
    1. Briefly acknowledge or evaluate ${applicant}'s answer (1-2 sentences).
    2. Ask the next relevant interview question based on their answer, the Job Description, and their resume.
    
    Make sure your response sounds natural and conversational to be spoken aloud. Do not include any formatting like bolding or bullet points. Just output plain text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: prompt,
    });
    
    const reply = response.text || `Thank you, ${applicant}. Let's move on to the next topic. Can you tell me about your experience working in a team?`;
    
    return NextResponse.json({ 
      success: true, 
      reply: reply
    });

  } catch (error: any) {
    console.error('Error generating reply:', error);
    return NextResponse.json({ error: error.message || 'Error processing request' }, { status: 500 });
  }
}
