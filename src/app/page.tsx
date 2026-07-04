'use client';

import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import Image from 'next/image';

type AppState = 'IDLE' | 'UPLOADING' | 'INTERVIEW_ACTIVE' | 'EVALUATING' | 'FINISHED';
type InterviewState = 'AI_THINKING' | 'AI_SPEAKING' | 'USER_SPEAKING';
type Message = { role: 'user' | 'model'; text: string };
type Evaluation = {
  overallScore: number;
  technicalFeedback: string;
  communicationFeedback: string;
  improvements: string[];
};

export default function Home() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [interviewState, setInterviewState] = useState<InterviewState>('AI_THINKING');
  
  // User Inputs
  const [file, setFile] = useState<File | null>(null);
  const [applicantName, setApplicantName] = useState<string>('');
  const [jobDescription, setJobDescription] = useState<string>('');
  const [userApiKey, setUserApiKey] = useState<string>('');
  
  // Settings
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  
  // Data
  const [resumeText, setResumeText] = useState<string>('');
  const [atsScore, setAtsScore] = useState<number | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [transcription, setTranscription] = useState<string>('');
  const [aiSubtitle, setAiSubtitle] = useState<string>('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthesisRef.current = window.speechSynthesis;
      
      const loadVoices = () => {
        const voices = synthesisRef.current?.getVoices() || [];
        // Filter English voices to avoid clutter
        const enVoices = voices.filter(v => v.lang.startsWith('en'));
        setAvailableVoices(enVoices);
        if (enVoices.length > 0 && !selectedVoiceURI) {
           setSelectedVoiceURI(enVoices[0].voiceURI);
        }
      };

      loadVoices();
      if (synthesisRef.current?.onvoiceschanged !== undefined) {
        synthesisRef.current.onvoiceschanged = loadVoices;
      }
      
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        
        recognitionRef.current.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscription(currentTranscript);
        };
      } else {
        console.warn('SpeechRecognition API not supported in this browser.');
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const startInterview = async () => {
    if (!file || !applicantName.trim()) {
      alert('Please provide your name and a resume.');
      return;
    }
    
    setAppState('UPLOADING');
    
    const formData = new FormData();
    formData.append('resume', file);
    formData.append('applicantName', applicantName);
    formData.append('jobDescription', jobDescription);
    if (userApiKey.trim()) {
      formData.append('userApiKey', userApiKey.trim());
    }
    
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      
      if (data.success) {
        setResumeText(data.resumeText);
        if (data.atsScore) setAtsScore(data.atsScore);
        
        setAppState('INTERVIEW_ACTIVE');
        speak(data.initialQuestion);
      } else {
        alert(data.error);
        setAppState('IDLE');
      }
    } catch (err) {
      console.error(err);
      alert("Failed to start interview.");
      setAppState('IDLE');
    }
  };

  const speak = (text: string) => {
    if (!synthesisRef.current) return;
    
    // WORKAROUND FOR CHROME/EDGE BUG: Cancel any stuck utterances before speaking
    synthesisRef.current.cancel();

    setInterviewState('AI_SPEAKING');
    setAiSubtitle(text);
    
    setHistory((prev) => [...prev, { role: 'model', text }]);

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Ensure we have a valid voice, fallback to first English voice if available
    let voice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
    if (!voice && availableVoices.length > 0) {
      voice = availableVoices[0];
    }
    
    if (voice) {
      utterance.voice = voice;
    }
    
    utterance.rate = voiceSpeed;
    utterance.pitch = 1.0;
    
    utterance.onend = () => {
      setAiSubtitle('');
      startListening();
    };

    // Minor delay helps guarantee the cancel() call clears the queue
    setTimeout(() => {
      synthesisRef.current?.speak(utterance);
    }, 50);
  };

  const startListening = () => {
    setInterviewState('USER_SPEAKING');
    setTranscription('');
    if (recognitionRef.current) {
      try {
         recognitionRef.current.start();
      } catch (e) {
         console.warn("Recognition already started");
      }
    }
  };

  const stopListeningAndSend = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    
    if (!transcription.trim()) {
      alert("I didn't hear anything. Please try speaking again.");
      startListening();
      return;
    }

    setInterviewState('AI_THINKING');
    
    const newHistory: Message[] = [...history, { role: 'user', text: transcription }];
    setHistory(newHistory);
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: newHistory,
          answer: transcription,
          resumeText,
          jobDescription,
          applicantName,
          userApiKey: userApiKey.trim() || undefined
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        speak(data.reply);
      } else {
        alert(data.error);
        setInterviewState('USER_SPEAKING');
      }
    } catch (err) {
      console.error(err);
      alert("Network error.");
      setInterviewState('USER_SPEAKING');
    }
  };

  const endInterview = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (synthesisRef.current) {
      synthesisRef.current.cancel(); // Stop AI speaking if it is
    }
    
    setAppState('EVALUATING');
    
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history,
          resumeText,
          jobDescription,
          applicantName,
          userApiKey: userApiKey.trim() || undefined
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setEvaluation(data.evaluation);
        setAppState('FINISHED');
        generateAndDownloadPDF(data.evaluation);
      } else {
        alert(data.error);
        setAppState('INTERVIEW_ACTIVE');
      }
    } catch (err) {
      console.error(err);
      alert("Failed to generate evaluation.");
      setAppState('INTERVIEW_ACTIVE');
    }
  };

  const generateAndDownloadPDF = (evalData: Evaluation) => {
    const doc = new jsPDF();
    const margin = 20;
    let y = margin;
    
    const pageWidth = doc.internal.pageSize.width;
    
    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(30, 58, 138); // Deep blue
    doc.text("AI Interview Scorecard", pageWidth / 2, y, { align: "center" });
    
    y += 15;
    
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(`Candidate Name: ${applicantName || 'Applicant'}`, margin, y);
    y += 8;
    doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, y);
    
    if (atsScore !== null) {
        y += 8;
        doc.text(`ATS Match Score: ${atsScore}%`, margin, y);
    }
    
    y += 20;
    
    // Overall Score
    doc.setFontSize(18);
    doc.setTextColor(16, 185, 129); // Emerald
    doc.text(`Overall Score: ${evalData.overallScore} / 100`, margin, y);
    
    y += 15;
    
    // Helper to wrap text
    const addSection = (title: string, text: string | string[], isList: boolean = false) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(30, 58, 138);
        doc.text(title, margin, y);
        y += 8;
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.setTextColor(50, 50, 50);
        
        if (isList && Array.isArray(text)) {
            text.forEach(item => {
                const lines = doc.splitTextToSize(`• ${item}`, pageWidth - margin * 2);
                doc.text(lines, margin, y);
                y += lines.length * 6;
            });
        } else {
            const lines = doc.splitTextToSize(text as string, pageWidth - margin * 2);
            doc.text(lines, margin, y);
            y += lines.length * 6;
        }
        
        y += 10;
        
        if (y > 270) {
            doc.addPage();
            y = margin;
        }
    };
    
    addSection("Technical Proficiency", evalData.technicalFeedback);
    addSection("Communication Skills", evalData.communicationFeedback);
    addSection("Areas for Improvement", evalData.improvements, true);
    
    doc.save(`Interview_Scorecard_${applicantName || 'Applicant'}.pdf`);
  };

  return (
    <main className="container">
      {appState === 'IDLE' && (
        <div className="glass-panel idle-panel">
          <h1 className="title">AI Interviewer</h1>
          <p className="subtitle" style={{ fontSize: '1.3rem' }}>Configure your profile and preferences to begin your technical interview.</p>
          
          <div className="setup-grid">
            
            {/* Card 1: Applicant Profile */}
            <div className="setup-card">
              <h3>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Applicant Profile
              </h3>
              
              <div className="input-group">
                <label htmlFor="name">Full Name *</label>
                <input 
                  id="name"
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. John Doe" 
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                />
              </div>

              <div className="file-upload" style={{ margin: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="resume-upload" className="file-upload-label" style={{ flex: 1 }}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <span style={{ marginTop: '0.5rem', fontWeight: 500 }}>{file ? file.name : 'Upload PDF Resume *'}</span>
                  <span style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '0.25rem' }}>Drag & drop or click to browse</span>
                </label>
                <input 
                  id="resume-upload" 
                  type="file" 
                  accept=".pdf" 
                  onChange={handleFileChange} 
                />
              </div>
            </div>

            {/* Card 2: Interview Settings */}
            <div className="setup-card">
              <h3>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Role & Preferences
              </h3>

              <div className="input-group">
                <label htmlFor="jd">Job Description (Optional)</label>
                <textarea 
                  id="jd"
                  className="textarea-field" 
                  placeholder="Paste the role details to calculate an ATS score..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  style={{ minHeight: '80px' }}
                />
              </div>
              
              <div className="input-group">
                <label htmlFor="apikey">Gemini API Key (Optional)</label>
                <input 
                  id="apikey"
                  type="password"
                  className="input-field" 
                  placeholder="Leave blank to use default Trial API"
                  value={userApiKey}
                  onChange={(e) => setUserApiKey(e.target.value)}
                />
              </div>

              <div className="input-row" style={{ marginBottom: 0 }}>
                <div className="input-group">
                  <label htmlFor="speed">AI Speed</label>
                  <select 
                    id="speed"
                    className="select-field"
                    value={voiceSpeed}
                    onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                  >
                    <option value={0.8}>0.8x</option>
                    <option value={1.0}>1.0x</option>
                    <option value={1.2}>1.2x</option>
                    <option value={1.5}>1.5x</option>
                  </select>
                </div>
                
                <div className="input-group" style={{ flex: 2 }}>
                  <label htmlFor="voice">AI Voice</label>
                  <select 
                    id="voice"
                    className="select-field"
                    value={selectedVoiceURI}
                    onChange={(e) => setSelectedVoiceURI(e.target.value)}
                  >
                    {availableVoices.map((v) => (
                       <option key={v.voiceURI} value={v.voiceURI}>
                         {v.name.substring(0, 30)}
                       </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

          </div>
          
          <button 
            className="btn" 
            style={{ marginTop: '3rem', fontSize: '1.25rem', padding: '1.25rem' }}
            onClick={startInterview}
            disabled={!file || !applicantName.trim()}
          >
            Start Interview
          </button>
        </div>
      )}

      {appState === 'UPLOADING' && (
        <div className="glass-panel">
           <div className="status-indicator">
              <div className="pulse-ring thinking"></div>
           </div>
           <h2 className="status-text thinking" style={{marginTop: '2rem'}}>Analyzing Context & Calculating ATS Match...</h2>
        </div>
      )}
      
      {appState === 'EVALUATING' && (
        <div className="glass-panel">
           <div className="status-indicator">
              <div className="pulse-ring speaking"></div>
           </div>
           <h2 className="status-text speaking" style={{marginTop: '2rem'}}>Generating Interview Scorecard...</h2>
           <p className="subtitle" style={{marginTop: '1rem'}}>Reviewing your answers and computing your final score.</p>
        </div>
      )}

      {appState === 'FINISHED' && evaluation && (
        <div className="glass-panel full-width">
           <h1 className="title">Interview Complete</h1>
           <p className="subtitle">Your official scorecard has been securely downloaded to your device as a PDF.</p>
           
           <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem' }}>
              <button className="btn" style={{ width: 'auto', background: '#3b82f6' }} onClick={() => generateAndDownloadPDF(evaluation)}>
                Re-Download PDF
              </button>
              <button className="btn" style={{ width: 'auto' }} onClick={() => window.location.reload()}>
                Start New Interview
              </button>
           </div>
        </div>
      )}

      {appState === 'INTERVIEW_ACTIVE' && (
        <div className="glass-panel full-width">
          <div className="top-bar">
            {atsScore !== null && (
               <div className="ats-badge">
                 <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                 </svg>
                 ATS Match Score: {atsScore}%
               </div>
            )}
            
            <button className="end-btn" onClick={endInterview}>
               End Interview
            </button>
          </div>
          
          <div className="split-screen">
            
            {/* AI INTERVIEWER PANE */}
            <div className={`participant-pane ai-pane ${interviewState === 'AI_SPEAKING' ? 'active' : interviewState === 'AI_THINKING' ? 'thinking' : ''}`}>
               <h3 className="participant-name">AI_Interviewer</h3>
               <div className="avatar-wrapper">
                  <div className="pulse-ring-avatar"></div>
                  <Image src="/ai_logo.png" alt="AI Avatar" className="avatar-img" width={160} height={160} priority />
               </div>
               
               <div className="status-badge">
                 {interviewState === 'AI_SPEAKING' ? 'Speaking' : interviewState === 'AI_THINKING' ? 'Thinking' : 'Listening'}
               </div>
               
               {/* Display AI Subtitles Exclusively Here */}
               {interviewState === 'AI_SPEAKING' && aiSubtitle && (
                 <div className="ai-subtitle">
                   {aiSubtitle}
                 </div>
               )}
            </div>

            {/* APPLICANT PANE */}
            <div className={`participant-pane user-pane ${interviewState === 'USER_SPEAKING' ? 'active' : ''}`}>
               <h3 className="participant-name">{applicantName || 'Applicant'}</h3>
               <div className="avatar-wrapper">
                  <div className="pulse-ring-avatar"></div>
                  <Image src="/applicant_logo.png" alt="Applicant Avatar" className="avatar-img" width={160} height={160} priority />
               </div>
               
               <div className="status-badge">
                 {interviewState === 'USER_SPEAKING' ? 'Your Turn' : 'Waiting'}
               </div>

               {interviewState === 'USER_SPEAKING' && (
                 <>
                   <div className="transcription">
                     "{transcription || "..."}"
                   </div>
                   <button className="btn" onClick={stopListeningAndSend}>
                     Submit Answer
                   </button>
                 </>
               )}
            </div>

          </div>
        </div>
      )}
    </main>
  );
}
