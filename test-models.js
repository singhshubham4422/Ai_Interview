const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf-8');
const keyMatch = envContent.match(/GEMINI_API_KEY=(.*)/);
const apiKey = keyMatch ? keyMatch[1].trim() : null;

async function listModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.models) {
        console.log("Available Models:");
        data.models.forEach(m => console.log(m.name));
    } else {
        console.log("Error fetching models:", data);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

listModels();
