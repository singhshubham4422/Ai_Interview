import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize Gemini API
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('resume') as File | null;
    const applicantName = formData.get('applicantName') as string;
    const jobDescription = formData.get('jobDescription') as string;
    const userApiKey = formData.get('userApiKey') as string;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No resume provided.' }, { status: 400 });
    }

    const key = userApiKey || process.env.API || process.env.GEMINI_API_KEY;
    if (!key) {
       return NextResponse.json({ success: false, error: 'No API key provided.' }, { status: 400 });
    }
    
    const ai = new GoogleGenAI({ apiKey: key });
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Parse PDF
    const PDFParser = require('pdf2json');
    const resumeText = await new Promise<string>((resolve, reject) => {
      const pdfParser = new PDFParser(null, 1);
      pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
      pdfParser.on("pdfParser_dataReady", () => {
        resolve(pdfParser.getRawTextContent());
      });
      pdfParser.parseBuffer(buffer);
    });
    
    if (!resumeText || resumeText.trim().length === 0) {
       return NextResponse.json({ error: 'Could not extract text from PDF' }, { status: 400 });
    }

    // Generate first question and ATS score
    const prompt = `You are an expert technical interviewer and ATS system. Your name is AI_Interviewer.
    You are interviewing ${applicantName}.
    
    ${jobDescription ? `The candidate is applying for the following role/Job Description:\n${jobDescription}\n` : ''}
    Here is the candidate's resume:
    
    ${resumeText.substring(0, 5000)}
    
    Based on this context:
    1. Calculate an ATS match score out of 100 based on how well the resume aligns with the Job Description. (If no Job Description is provided, just estimate a score based on general software engineering roles, or default to 85).
    2. Ask the candidate one single, engaging introductory interview question. Make it conversational and friendly. Do not include any pleasantries or pre-amble.
    
    OUTPUT FORMAT: You MUST return a valid JSON object with EXACTLY two keys: "atsScore" (number) and "initialQuestion" (string). Do not wrap the JSON in markdown blocks like \`\`\`json. Return ONLY the raw JSON string.`;

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: prompt,
    });
    
    let aiResponse = response.text || "{}";
    aiResponse = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let parsedResponse = { atsScore: 85, initialQuestion: `Hello ${applicantName}! Could you tell me a little bit about yourself and your background?` };
    
    try {
      const parsed = JSON.parse(aiResponse);
      if (parsed.atsScore) parsedResponse.atsScore = parsed.atsScore;
      if (parsed.initialQuestion) parsedResponse.initialQuestion = parsed.initialQuestion;
    } catch (e) {
      console.warn("Failed to parse Gemini JSON output:", aiResponse);
    }
    
    return NextResponse.json({ 
      success: true, 
      resumeText: resumeText,
      initialQuestion: parsedResponse.initialQuestion,
      atsScore: parsedResponse.atsScore
    });

  } catch (error: any) {
    console.error('Error parsing PDF:', error);
    return NextResponse.json({ error: error.message || 'Error processing request' }, { status: 500 });
  }
}
