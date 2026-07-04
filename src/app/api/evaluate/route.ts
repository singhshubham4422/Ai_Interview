import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: Request) {
  try {
    const { history, resumeText, jobDescription, applicantName, userApiKey } = await req.json();

    const key = userApiKey || process.env.API || process.env.GEMINI_API_KEY;
    if (!key) {
       return NextResponse.json({ success: false, error: 'No API key provided.' }, { status: 400 });
    }
    
    const ai = new GoogleGenAI({ apiKey: key });

    if (!history || history.length === 0) {
      return NextResponse.json({ error: 'No conversation history provided' }, { status: 400 });
    }
    
    const applicant = applicantName || 'the applicant';

    let conversationHistory = history.map((msg: any) => `${msg.role === 'user' ? applicant : 'AI_Interviewer'}: ${msg.text}`).join('\n');

    const prompt = `You are an expert technical hiring manager named AI_Interviewer evaluating an interview with ${applicant}.
    
    ${jobDescription ? `Job Description / Role context:\n${jobDescription}\n` : ''}
    Resume Context:
    ${resumeText.substring(0, 5000)}
    
    Interview Transcript:
    ${conversationHistory}
    
    Task:
    Review the entire interview transcript and evaluate the candidate's performance.
    
    OUTPUT FORMAT: You MUST return a valid JSON object with the following keys:
    - "overallScore": a number between 0 and 100 representing their overall performance.
    - "technicalFeedback": a short paragraph (3-4 sentences) evaluating their technical knowledge and depth of answers.
    - "communicationFeedback": a short paragraph (2-3 sentences) evaluating their communication skills, clarity, and confidence.
    - "improvements": an array of 2 to 4 strings, where each string is a specific area of improvement or actionable advice for the candidate.
    
    Do not wrap the JSON in markdown blocks like \`\`\`json. Return ONLY the raw JSON string.`;

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: prompt,
    });
    
    let aiResponse = response.text || "{}";
    aiResponse = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let parsedResponse = { 
       overallScore: 0, 
       technicalFeedback: "Evaluation unavailable.", 
       communicationFeedback: "Evaluation unavailable.",
       improvements: ["No improvements available."]
    };
    
    try {
      const parsed = JSON.parse(aiResponse);
      if (parsed.overallScore) parsedResponse.overallScore = parsed.overallScore;
      if (parsed.technicalFeedback) parsedResponse.technicalFeedback = parsed.technicalFeedback;
      if (parsed.communicationFeedback) parsedResponse.communicationFeedback = parsed.communicationFeedback;
      if (parsed.improvements) parsedResponse.improvements = parsed.improvements;
    } catch (e) {
      console.warn("Failed to parse Gemini JSON output:", aiResponse);
    }
    
    return NextResponse.json({ 
      success: true, 
      evaluation: parsedResponse
    });

  } catch (error: any) {
    console.error('Error generating evaluation:', error);
    return NextResponse.json({ error: error.message || 'Error processing request' }, { status: 500 });
  }
}
