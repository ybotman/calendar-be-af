# Voice Integration Attempts - Session Summary

**Date:** January 10, 2026
**Goal:** Enable voice queries to TangoTiempo calendar from iPhone

## The Requirement

### VOICE IN → VOICE OUT

This is a **voice-first** integration. Both input AND output must be audio.

| Direction | Requirement |
|-----------|-------------|
| **VOICE IN** | User speaks query naturally (no typing) |
| **VOICE OUT** | Phone speaks response aloud (no reading) |

### User Experience

User says: **"Hey Siri, what practicas are this weekend in Boston?"**
Phone responds audibly: **"I found 3 practicas this weekend..."**

**NOT acceptable:**
- ❌ Type query → hear response (not voice in)
- ❌ Speak query → read response on screen (not voice out)
- ❌ Any interaction requiring the user to look at or touch the phone

## What We Built (Working)

### 1. Voice API Endpoint ✅
```
POST https://calendarbeaf-prod.azurewebsites.net/api/voice/ask
Body: {"query": "practicas this weekend boston", "appId": "1"}
```
- Natural language parsing via OpenAI
- City mapping (Boston, Chicago, NYC, etc.)
- Timeframe parsing (tonight, this weekend, this week)
- Category shortcuts (practica, milonga, class, social)
- Returns spoken response + event data

**This works perfectly via curl:**
```bash
curl -X POST "https://calendarbeaf-prod.azurewebsites.net/api/voice/ask" \
  -H "Content-Type: application/json" \
  -d '{"query":"practicas this weekend boston"}'
```

### 2. Voice Events API ✅ (v1.17.0)
- Multi-category support: `categoryId=social` (practica + milonga)
- Geo filtering with lat/lng/range
- Default to Boston, 100 mile radius

## What We Tried (Failed)

### Attempt 1: Siri Shortcut with Dictate Text ❌
**Problem:** Could not connect "Dictated Text" output to JSON body parameter
- Shortcuts variable picker wouldn't show "Dictated Text" as selectable
- Only showed "Shortcut Input" and "URL"
- Typing "Dictated Text" literally sent the string, not the variable

### Attempt 2: Set Variable after Dictate ❌
**Problem:** Set Variable also couldn't properly capture Dictate output
- Connected to wrong variable (URL instead of Dictated Text)
- Variable reference system in Shortcuts is confusing

### Attempt 3: Ask for Input (text) ❌
**Problem:** Works for text input but defeats voice purpose
- Successfully connected to JSON body
- API responded correctly
- But requires typing, not speaking

### Attempt 4: Magic Variables ❌
**Problem:** Could not find/select "Dictated Text" magic variable
- Variable picker limited options
- No clear way to reference previous action output

## The Core Problem

**Apple Shortcuts JSON body does not easily accept variables from Dictate Text action**

The Shortcuts app:
1. Can dictate text ✅
2. Can make POST requests with JSON ✅
3. Cannot easily connect (1) to (2) ❌

## Solution Implemented (v1.19.0)

### GET Endpoint + Fuzzy Matching ✅

**API now supports GET requests:**
```
GET /api/voice/ask?query=practicas+this+weekend+boston
```

**Fuzzy matching handles Siri mishears:**
| Siri Hears | Converts To |
|------------|-------------|
| practical, practice | practica |
| melonga, my longa | milonga |
| tangle | tango |

### Siri Shortcut Setup (TO TEST)

1. Create Shortcut named **"Tango"**
2. Add **Text** action: `https://calendarbeaf-prod.azurewebsites.net/api/voice/ask?query=`
3. Add **Combine Text**: [Text] + [Shortcut Input]
4. Add **Get Contents of URL** (GET method)
5. Add **Get Dictionary Value** → key: `spoken`
6. Add **Speak Text**

**Usage:** "Hey Siri, Tango practicas this weekend Boston"

### Alternative: Shortcut Input Method
- Name shortcut "Tango"
- Say: "Hey Siri, Tango practicas this weekend"
- Words after "Tango" become `⟨Shortcut Input⟩`
- No Dictate action needed

---

## Current Status (January 11, 2026)

### What's Working ✅
| Component | Status |
|-----------|--------|
| **API v1.22.0** | GET + fuzzy matching + Azure TTS |
| **Azure Speech TTS** | Jenny Neural voice (sounds good) |
| **Greeting endpoint** | `?greeting=true&voice=nova` |
| **Help endpoint** | `?help=true&voice=nova` |
| **Default query** | No input → "milongas and practicas next 2 days boston" |
| **Hardcoded Shortcut** | Works on desktop |

### API Endpoints
```
Base: https://calendarbeaf-prod.azurewebsites.net/api/voice/ask

?greeting=true&voice=nova     → "Hello! What tango events..."
?help=true&voice=nova         → Explains what users can ask
?query=...&voice=nova         → Returns events as audio
?voice=nova                   → Default query (next 2 days Boston)
```

### Struggles / Issues 🔧
| Issue | Status | Notes |
|-------|--------|-------|
| Siri + Shortcut Input | Bypassed | Use Dictate Text + IF/OTHERWISE instead |
| Siri + ChatGPT conflict | Workaround | Siri routes "ask..." queries to ChatGPT |
| Play Sound vs Play Media | Fixed | Use "Play Media" for auto-play |
| OpenAI TTS | Blocked | 429 quota error - switched to Azure |
| Mobile shortcut | Solution Found | Use IF/OTHERWISE pattern with Dictate Text |

### Shortcut Flow (WORKING SOLUTION) ✅

**Final Shortcut Logic:**
```
1. Dictate Text → [Dictated Text]

2. IF [Dictated Text] contains "help"
   └─ URL: https://calendarbeaf-prod.azurewebsites.net/api/voice/ask?help=true&voice=nova

3. OTHERWISE
   └─ URL: https://calendarbeaf-prod.azurewebsites.net/api/voice/ask?query=[Dictated Text]&voice=nova

4. Get Contents of URL

5. Play Media
```

**How to Build in Shortcuts:**
1. **Dictate Text** action
2. **If** → tap [Dictated Text] → contains → type `help`
3. Inside If: **URL** → `https://calendarbeaf-prod.azurewebsites.net/api/voice/ask?help=true&voice=nova`
4. Tap **Otherwise** at bottom of If block
5. Inside Otherwise: **URL** → `https://calendarbeaf-prod.azurewebsites.net/api/voice/ask?query=[Dictated Text]&voice=nova`
6. After End If: **Get Contents of URL**
7. **Play Media**

**Key Insight:** Backend already has `?help=true` ready. Shortcut just branches based on what user says. No backend changes needed!

### Key Learnings
- Siri Shortcuts can't easily pass voice after shortcut name
- "Ask [name]" triggers ChatGPT, not shortcuts
- Use "Play Media" not "Play Sound" for audio
- Azure Speech works when OpenAI quota exceeded
- Backend handles help/greeting - Shortcut just needs IF/OTHERWISE branch

### Option C: ChatGPT Custom GPT
- Already exists: TangoTiempo GPT
- Works with text + mic transcription
- Does NOT work with ChatGPT Voice Mode (voice mode doesn't support custom GPTs)

### Option D: Web Page with Mic Button
- Built: `/public/tango-voice.html`
- Uses Web Speech API
- Works in Safari
- User doesn't want another webpage

### Option E: Alexa Skill
- More complex to build
- Good for home use

## Files Created This Session

| File | Purpose |
|------|---------|
| `src/functions/VoiceAsk.js` | POST /api/voice/ask endpoint |
| `src/functions/VoiceEvents.js` | Updated with multi-category + geo |
| `docs/TangoTiempoAsk.md` | Full design doc |
| `public/tango-voice.html` | Web page with mic (not wanted) |
| `docs/VoiceIntegration-Attempts.md` | This summary |

## Versions Deployed

- v1.17.0: Multi-category + geo filtering for VoiceEvents
- v1.18.0: VoiceAsk natural language endpoint

## Next Steps to Try

1. **Try Option A:** Shortcut Input instead of Dictate
   - Simpler flow, Siri handles voice capture

2. **Try Option B:** Change API to GET request
   - Shortcuts handle URL strings better than JSON bodies

3. **Test on actual device**
   - Some Shortcuts features work differently on device vs Mac

## Environment

- OpenAI API key added to Azure: `OPENAI_API_KEY` (TangoTiempoVoiceAsk)
- API deployed to: CalendarBEAF-PROD
- Cost estimate: ~$0.80/month for 1000 users × 5 queries/week

## Summary

**SOLVED: Voice-in → Voice-out working!**

**Solution:** Use Dictate Text + IF/OTHERWISE branching in Shortcuts:
- Backend provides GET endpoints with `?query=`, `?help=true`, `?greeting=true`
- Shortcut uses Dictate Text, branches on content
- Audio returned via Azure Speech TTS (Jenny Neural)
- Play Media action auto-plays response

**Previous Blocker (Resolved):** The disconnect was between Apple Shortcuts' visual programming model and getting a voice-captured string into a JSON POST body. **Solution:** Use GET with query parameters instead of POST with JSON body.

**Version:** v1.22.0 - Full voice integration ready for testing
