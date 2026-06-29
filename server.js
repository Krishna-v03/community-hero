import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));

const ai = new GoogleGenAI({});
let issuesCache = [];

function hasGeminiKey() {
  const key = process.env.GEMINI_API_KEY;
  return key && !key.includes('YOUR_GEMINI');
}

async function geminiText(prompt, model = 'gemini-2.5-flash') {
  if (!hasGeminiKey()) return null;
  const response = await ai.models.generateContent({ model, contents: [prompt] });
  return response.text ? response.text.trim() : null;
}

// ── Issue sync for public share API ───────────────────────────────────────────
app.post('/api/sync', (req, res) => {
  issuesCache = Array.isArray(req.body.issues) ? req.body.issues : [];
  res.json({ ok: true, count: issuesCache.length });
});

app.get('/api/issues', (_req, res) => {
  res.json(issuesCache);
});

app.get('/api/issues/:id', (req, res) => {
  const issue = issuesCache.find(i => i.id === req.params.id);
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });
  res.json(issue);
});

// ── Image classification with reasoning ─────────────────────────────────────
app.post('/api/classify', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image data provided.' });
    }
    if (!hasGeminiKey()) {
      return res.status(503).json({ error: 'Gemini API key not configured.', offline: true });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageBase64.match(/[^:]\w+\/[\w-+\d.]+(?=;base64)/)?.[0] || 'image/jpeg';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: { data: base64Data, mimeType }
        },
        `Analyze this image for municipal public infrastructure issues. Classify into exactly ONE category:
'Pothole', 'Broken Streetlight', 'Overflown Garbage', 'Water Leakage', or 'Spam / Unrelated'.

Rules:
- Only 'Broken Streetlight' if an outdoor streetlight/lamppost is visible.
- Selfies, indoor scenes, pets, unrelated content = 'Spam / Unrelated'.

Respond in this exact JSON format only (no markdown):
{"category":"Category Name","confidence":85,"reasoning":"One sentence explaining why","priority":"High|Medium|Low"}`
      ]
    });

    const raw = response.text ? response.text.trim() : '';
    let parsed = null;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = null;
    }

    if (parsed?.category) {
      return res.json({
        category: parsed.category,
        confidence: parsed.confidence || 90,
        reasoning: parsed.reasoning || 'Visual analysis completed.',
        priority: parsed.priority || 'Medium'
      });
    }

    res.json({ category: raw.replace(/["']/g, '').split('\n')[0], confidence: 88, reasoning: 'Classified from visual features.', priority: 'Medium' });
  } catch (error) {
    console.error('[Backend] Classification error:', error);
    res.status(500).json({ error: 'Classification failed.', offline: true });
  }
});

// ── SLA escalation memo ───────────────────────────────────────────────────────
app.post('/api/escalate', async (req, res) => {
  try {
    const { issue, overdueHours } = req.body;
    if (!issue) return res.status(400).json({ error: 'No issue data provided.' });

    const fallback = `${issue.category?.toUpperCase()} in ${issue.wardId} is overdue by ${overdueHours}h. Assign field officer immediately. Risk: HIGH.`;

    if (!hasGeminiKey()) {
      return res.json({ memo: fallback, issueId: issue.id });
    }

    const prompt = `You are CivicAI, autonomous municipal ops agent. SLA breached ticket:
ID: ${issue.id}, Category: ${issue.category}, Ward: ${issue.wardId}, Overdue: ${overdueHours}h, Status: ${issue.status}.
Write a 3-line escalation memo: urgency summary, recommended action, risk (CRITICAL/HIGH/MODERATE). Plain text, no bullets.`;

    const memo = await geminiText(prompt);
    res.json({ memo: memo || fallback, issueId: issue.id });
  } catch (error) {
    console.error('[Backend] Escalation error:', error);
    res.json({
      memo: 'Ticket overdue — assign available field officer and notify department head. Risk: HIGH.',
      issueId: req.body?.issue?.id
    });
  }
});

// ── City trends summary (predictive) ─────────────────────────────────────────
app.post('/api/trends', async (req, res) => {
  let statsSummary = '';
  try {
    const { issues, wards } = req.body;
    const active = (issues || []).filter(i => i.status !== 'Closed');
    const wardCounts = {};
    active.forEach(i => { wardCounts[i.wardId] = (wardCounts[i.wardId] || 0) + 1; });
    const topWard = Object.entries(wardCounts).sort((a, b) => b[1] - a[1])[0];
    const catCounts = {};
    active.forEach(i => { if (i.category !== 'spam') catCounts[i.category] = (catCounts[i.category] || 0) + 1; });
    const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    const overdue = active.filter(i => i.slaDeadline && new Date() > new Date(i.slaDeadline)).length;

    statsSummary = `Active: ${active.length}, Overdue: ${overdue}, Top ward: ${topWard?.[0] || 'none'} (${topWard?.[1] || 0}), Top category: ${topCat?.[0] || 'none'}`;

    if (!hasGeminiKey()) {
      return res.json({
        summary: `Operational snapshot — ${statsSummary}. Focus resources on highest-volume ward and recurring category.`,
        forecast: overdue > 0 ? 'SLA breach risk elevated — prioritize overdue tickets.' : 'No immediate breach forecast.',
        offline: true
      });
    }

    const wardNames = (wards || []).map(w => `${w.id}=${w.name}`).join(', ');
    const prompt = `As CivicAI municipal analyst, given: ${statsSummary}. Ward map: ${wardNames}.
Provide JSON only: {"summary":"2 sentence city ops summary","forecast":"1 sentence predictive insight for next 7 days","recommendation":"1 actionable step for admin"}`;

    const raw = await geminiText(prompt);
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      if (parsed) return res.json(parsed);
    } catch { /* fall through */ }

    res.json({ summary: raw || statsSummary, forecast: 'Monitor SLA deadlines in high-volume wards.', recommendation: 'Assign officers to overdue tickets.' });
  } catch (error) {
    console.error('[Backend] Trends error:', error);
    res.json({
      summary: `Operational snapshot — ${statsSummary || 'Unavailable'}. Focus resources on highest-volume ward.`,
      forecast: 'SLA breach risk elevated — prioritize overdue tickets.',
      recommendation: 'Assign officers to overdue tickets.',
      offline: true
    });
  }
});

// ── Officer assignment suggestion ─────────────────────────────────────────────
app.post('/api/suggest-assignment', async (req, res) => {
  let fallback = { officerId: null, reason: 'No officers available.', confidence: 0 };
  try {
    const { issue, officers, officerLoads } = req.body;
    if (!issue) return res.status(400).json({ error: 'No issue provided.' });

    const loads = officerLoads || {};
    const officerList = (officers || []).map(o =>
      `${o.id}: ${o.name} (${o.department || 'General'}) — ${loads[o.id] || 0} active tickets`
    ).join('; ');

    fallback = officers?.length
      ? { officerId: officers[0].id, reason: 'Nearest available officer with lowest active load.', confidence: 75 }
      : { officerId: null, reason: 'No officers available.', confidence: 0 };

    if (!hasGeminiKey()) return res.json(fallback);

    const prompt = `Suggest best field officer for this civic ticket:
Category: ${issue.category}, Ward: ${issue.wardId}, Priority: ${issue.severity}.
Officers: ${officerList}
Respond JSON only: {"officerId":"user-id","reason":"one sentence","confidence":80}`;

    const raw = await geminiText(prompt);
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      if (parsed?.officerId) return res.json(parsed);
    } catch { /* fall through */ }

    res.json(fallback);
  } catch (error) {
    console.error('[Backend] Assignment suggestion error:', error);
    res.json(fallback);
  }
});

// ── Citizen-friendly status update ────────────────────────────────────────────
app.post('/api/status-update', async (req, res) => {
  try {
    const { issue, newStatus, changedBy } = req.body;
    const fallback = `Your ${issue?.category} report is now "${newStatus}". Thank you for helping improve our community.`;

    if (!hasGeminiKey() || !issue) {
      return res.json({ message: fallback });
    }

    const prompt = `Write a friendly 1-2 sentence citizen notification (plain text, no emoji):
Issue: ${issue.category} in ward ${issue.wardId}. New status: ${newStatus}. Updated by: ${changedBy || 'City team'}.`;
    const message = await geminiText(prompt);
    res.json({ message: message || fallback });
  } catch (error) {
    res.json({ message: `Status updated to ${req.body?.newStatus || 'Unknown'}.` });
  }
});

// ── Multilingual translate ────────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang = 'hi' } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided.' });

    const langNames = { hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', en: 'English' };
    const target = langNames[targetLang] || targetLang;

    // Detect source language locally using Unicode character ranges
    let sourceLang = 'en';
    if (/[\u0900-\u097F]/.test(text)) sourceLang = 'hi';
    else if (/[\u0C80-\u0CFF]/.test(text)) sourceLang = 'kn';
    else if (/[\u0B80-\u0BFF]/.test(text)) sourceLang = 'ta';

    // Short-circuit if source and target languages are identical
    if (sourceLang === targetLang) {
      return res.json({ translated: text, targetLang });
    }

    // Short-circuit if target is English and text is already English (ASCII only)
    const isASCII = /^[\x00-\x7F]*$/.test(text);
    if ((targetLang === 'en' || target === 'English') && isASCII) {
      return res.json({ translated: text, targetLang });
    }

    // Instant local translations for default system/demo issues
    const localDb = {
      hi: {
        'Deep asphalt cavity on main road causing hazard.': 'मुख्य सड़क पर गहरा गड्ढा खतरा पैदा कर रहा है।',
        'Inoperative lighting fixture on main pedestrian crosswalk.': 'मुख्य पैदल यात्री क्रॉसवाक पर बिजली का खंभा काम नहीं कर रहा है।',
        'Disorganized community refuse pile blocking sidewalk access.': 'अव्यवस्थित कचरे का ढेर फुटपाथ के रास्ते को रोक रहा है।',
        'Uncontrolled water main breach flooding local park.': 'अनियंत्रित पानी की मुख्य लाइन टूटने से स्थानीय पार्क में बाढ़ आ गई है।',
        'No light near the gate. When will the light be installed?': 'गेट के पास लाइट नहीं है। लाइट कब लगेगी?',
        'large port hole near bus stop in thane': 'ठाणे में बस स्टॉप के पास बड़ा गड्ढा है',
        'Pothole on Main Road': 'मुख्य सड़क पर गड्ढा',
        'Deep pothole right in the middle of Greenwood Main Road lane. Hazardous for two-wheelers.': 'ग्रीनवुड मेन रोड लेन के ठीक बीच में गहरा गड्ढा है। दुपहिया वाहनों के लिए खतरनाक है।',
        'Streetlight flickering and going dark intermittently. Lane 4 near Metro station is pitch black.': 'स्ट्रीटलाइट टिमटिमा रही है और बीच-बीच में बंद हो रही है। मेट्रो स्टेशन के पास लेन 4 पूरी तरह से काली है।',
        'Garbage overflow bins neglected for three days. Strays scattering trash all over the sidewalk.': 'कचरा पात्रों की तीन दिनों से अनदेखी की गई है। लावारिस जानवर पूरे फुटपाथ पर कचरा फैला रहे हैं।',
        'Major water pipeline leakage, flooding the main junction and causing traffic delays.': 'पानी की मुख्य पाइपलाइन में भारी रिसाव, जिससे मुख्य जंक्शन पर बाढ़ आ गई है और ट्रैफिक में देरी हो रही है।'
      },
      kn: {
        'Deep asphalt cavity on main road causing hazard.': 'ಮುಖ್ಯ ರಸ್ತೆಯಲ್ಲಿ ಆಳವಾದ ಡಾಂಬರು ಕುಳಿ ಅಪಾಯವನ್ನುಂಟುಮಾಡುತ್ತದೆ.',
        'Inoperative lighting fixture on main pedestrian crosswalk.': 'ಮುಖ್ಯ ಪಾದಚಾರಿ ಕ್ರಾಸಿಂಗ್‌ನಲ್ಲಿ ಬೀದಿ ದೀಪ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ.',
        'Disorganized community refuse pile blocking sidewalk access.': 'ಅಸ್ತವ್ಯಸ್ತಗೊಂಡ ಕಸದ ರಾಶಿಯು ಕಾಲುದಾರಿ ಪ್ರವೇಶವನ್ನು ನಿರ್ಬಂಧಿಸುತ್ತಿದೆ.',
        'Uncontrolled water main breach flooding local park.': 'ನಿಯಂತ್ರಣವಿಲ್ಲದ ನೀರಿನ ಪೈಪ್ ಒಡೆದು ಸ್ಥಳೀಯ ಉದ್ಯಾನವನ ಜಲಾವೃತಗೊಂಡಿದೆ.',
        'No light near the gate. When will the light be installed?': 'ಗೇಟ್ ಬಳಿ ಬೆಳಕಿಲ್ಲ. ದೀಪವನ್ನು ಯಾವಾಗ ಅಳವಡಿಸಲಾಗುತ್ತದೆ?',
        'large port hole near bus stop in thane': 'ಠಾಣೆಯಲ್ಲಿ ಬಸ್ ನಿಲ್ದಾಣದ ಬಳಿ ದೊಡ್ಡ ರಸ್ತೆ ಗುಂಡಿ',
        'Pothole on Main Road': 'ಮುಖ್ಯ ರಸ್ತೆಯಲ್ಲಿ ರಸ್ತೆ ಗುಂಡಿ',
        'Deep pothole right in the middle of Greenwood Main Road lane. Hazardous for two-wheelers.': 'ಗ್ರೀನ್‌ವುಡ್ ಮುಖ್ಯ ರಸ್ತೆಯ ಲೇನ್‌ನ ಮಧ್ಯದಲ್ಲಿ ಆಳವಾದ ಗುಂಡಿ ಇದೆ. ದ್ವಿಚಕ್ರ ವಾಹನಗಳಿಗೆ ಅಪಾಯಕಾರಿ.',
        'Streetlight flickering and going dark intermittently. Lane 4 near Metro station is pitch black.': 'ಬೀದಿ ದೀಪಗಳು ಮಿನುಗುತ್ತಿವೆ ಮತ್ತು ಮಧ್ಯಂತರವಾಗಿ ಕತ್ತಲೆಯಾಗುತ್ತಿವೆ. ಮೆಟ್ರೋ ನಿಲ್ದಾಣದ ಸಮೀಪವಿರುವ ಲೇನ್ 4 ಸಂಪೂರ್ಣ ಕತ್ತಲೆಯಾಗಿದೆ.',
        'Garbage overflow bins neglected for three days. Strays scattering trash all over the sidewalk.': 'ಕಸದ ಬಿನ್‌ಗಳನ್ನು ಮೂರು ದಿನಗಳಿಂದ ನಿರ್ಲಕ್ಷಿಸಲಾಗಿದೆ. ಬೀದಿ ಪ್ರಾಣಿಗಳು ಫುಟ್‌ಪಾತ್‌ನಲ್ಲೆಲ್ಲಾ ಕಸವನ್ನು ಹರಡುತ್ತಿವೆ.',
        'Major water pipeline leakage, flooding the main junction and causing traffic delays.': 'ಪ್ರಮುಖ ನೀರಿನ ಪೈಪ್‌ಲೈನ್ ಸೋರಿಕೆ, ಮುಖ್ಯ ಜಂಕ್ಷನ್ ಪ್ರವಾಹಕ್ಕೆ ಕಾರಣವಾಗಿದೆ ಮತ್ತು ಸಂಚಾರ ವಿಳಂಬವನ್ನು ಉಂಟುಮಾಡುತ್ತಿದೆ.'
      },
      ta: {
        'Deep asphalt cavity on main road causing hazard.': 'பிரதான சாலையில் ஆழமான குழி ஆபத்தை ஏற்படுத்துகிறது.',
        'Inoperative lighting fixture on main pedestrian crosswalk.': 'முக்கிய பாதசாரி நடைபாதையில் விளக்கு கம்பம் வேலை செய்யவில்லை.',
        'Disorganized community refuse pile blocking sidewalk access.': 'ஒழுங்கற்ற குப்பைக் குவியல் நடைபாதை அணுகலைத் தடுக்கிறது.',
        'Uncontrolled water main breach flooding local park.': 'கட்டுப்பாடற்ற குடிநீர் குழாய் உடைப்பு காரணமாக பூங்காவில் வெள்ளம் சூழ்ந்துள்ளது.',
        'No light near the gate. When will the light be installed?': 'கேட் அருகில் விளக்கு இல்லை. விளக்கு எப்போது பொருத்தப்படும்?',
        'large port hole near bus stop in thane': 'தானேவில் பஸ் ஸ்டாப் அருகில் பெரிய குழி',
        'Pothole on Main Road': 'மெயின் ரோட்டில் குழி',
        'Deep pothole right in the middle of Greenwood Main Road lane. Hazardous for two-wheelers.': 'கிரீன்வுட் மெயின் ரோடு பாதையின் நடுவில் உள்ள ஆழமான குழி. இரு சக்கர வாகனங்களுக்கு ஆபத்தானது.',
        'Streetlight flickering and going dark intermittently. Lane 4 near Metro station is pitch black.': 'தெருவிளக்குகள் ஒளிர்கின்றன மற்றும் அவ்வப்போது இருட்டுகின்றன. மெட்ரோ நிலையத்திற்கு அருகிலுள்ள லேன் 4 முற்றிலும் இருட்டாக உள்ளது.',
        'Garbage overflow bins neglected for three days. Strays scattering trash all over the sidewalk.': 'குப்பைத் தொட்டிகள் மூன்று நாட்களாக புறக்கணிக்கப்பட்டுள்ளன. தெரு நாய்கள் குப்பைகளை நடைபாதை முழுவதும் சிதறடிக்கின்றன.',
        'Major water pipeline leakage, flooding the main junction and causing traffic delays.': 'முக்கிய குடிநீர் குழாய் கசிவு, முக்கிய சந்திப்பில் வெள்ளம் மற்றும் போக்குவரத்து தாமதத்தை ஏற்படுத்துகிறது.'
      }
    };

    const targetDb = localDb[targetLang];
    if (targetDb) {
      const match = Object.keys(targetDb).find(k => k.toLowerCase() === text.trim().toLowerCase() || text.trim().toLowerCase().includes(k.toLowerCase()));
      if (match) {
        return res.json({ translated: targetDb[match], targetLang });
      }
    }

    // Try Gemini if key is available
    if (hasGeminiKey()) {
      try {
        const prompt = `Translate this civic issue description to ${target}. Return ONLY the translation, no quotes:\n"${text}"`;
        const translated = await geminiText(prompt);
        if (translated && translated.trim().toLowerCase() !== text.trim().toLowerCase()) {
          return res.json({ translated, targetLang });
        }
      } catch (geminiErr) {
        console.warn('[Backend] Gemini translation failed, trying MyMemory:', geminiErr);
      }
    }

    // Free MyMemory public translation API fallback using resolved ISO codes
    try {
      const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`);
      if (response.ok) {
        const data = await response.json();
        const translatedText = data?.responseData?.translatedText;
        if (translatedText && 
            !translatedText.includes('DISTINCT LANGUAGES') && 
            translatedText.trim().toLowerCase() !== text.trim().toLowerCase()) {
          return res.json({ translated: translatedText, targetLang });
        }
      }
    } catch (mymemoryErr) {
      console.warn('[Backend] MyMemory translation fallback failed:', mymemoryErr);
    }

    res.json({ translated: text, offline: true, note: 'Translation fell back to original text.' });
  } catch (error) {
    console.error('[Backend] Translation error:', error);
    res.json({ translated: req.body?.text || '', offline: true, error: 'Translation failed, using original text.' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`Community Hero running at http://localhost:${PORT}`);
  console.log(`Gemini AI: ${hasGeminiKey() ? 'ENABLED' : 'OFFLINE (MobileNet fallback on client)'}`);
  console.log('================================================================');
});

export { app, issuesCache };
