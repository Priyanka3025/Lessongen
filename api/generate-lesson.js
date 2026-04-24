// LessonGen API - Generates CBSE 5E model lesson plans using Google Gemini

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      board,
      classLevel,
      subject,
      chapter,
      topic,
      language,
      learningObjective,
      teacherNotes
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY not configured on server. Please add it in Vercel environment variables.'
      });
    }

    const prompt = buildPrompt({
      board,
      classLevel,
      subject,
      chapter,
      topic,
      language,
      learningObjective,
      teacherNotes
    });

    // Try multiple models in order
    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    let response = null;
    let lastErrorText = '';
    let lastStatus = 0;

    for (const model of MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            console.log(`Success with ${model} on attempt ${attempt}`);
            break;
          }

          lastStatus = response.status;
          lastErrorText = await response.text();
          console.warn(`${model} attempt ${attempt} failed: ${response.status}`);

          if (response.status === 400 || response.status === 401 || response.status === 403) {
            break;
          }

          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (fetchErr) {
          lastErrorText = fetchErr.message;
          console.warn(`Fetch error for ${model}:`, fetchErr.message);
        }
      }

      if (response && response.ok) break;
    }

    if (!response || !response.ok) {
      console.error('All models failed. Last error:', lastErrorText);

      let errorMessage = `Gemini API error: ${lastStatus || 'Unknown'}`;
      try {
        const errorData = JSON.parse(lastErrorText);
        if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {}

      if (lastStatus === 429) {
        errorMessage = 'Rate limit reached. Please wait a minute and try again.';
      } else if (lastStatus === 503 || errorMessage.toLowerCase().includes('overload')) {
        errorMessage = 'AI servers are currently overloaded. Please try again in a moment.';
      }

      return res.status(lastStatus || 500).json({ error: errorMessage });
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }

    const generatedText = data.candidates[0].content.parts[0].text;
    
    let lessonPlan;
    try {
      lessonPlan = JSON.parse(generatedText);
    } catch (parseErr) {
      console.error('JSON parse error:', generatedText);
      throw new Error('Failed to parse lesson plan. Please try again.');
    }

    return res.status(200).json(lessonPlan);
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: error.message || 'Server error occurred' });
  }
};

function buildPrompt(config) {
  const language = config.language || 'English';
  
  // Language instruction block
  const languageNote = language === 'English' 
    ? '' 
    : `

============================
LANGUAGE REQUIREMENT (CRITICAL)
============================

Generate ALL TEXT CONTENT of the lesson plan in ${language}. This includes:
- Title
- Learning objectives
- Materials list
- Prior knowledge description
- All phase activities, dialogue, and explanations
- Differentiation strategies
- Homework description and tasks
- Expected outcomes
- Teacher tips
- Next lesson preview

KEEP these in English (do NOT translate):
- JSON keys/field names ("title", "metadata", "phases", "engage", etc.)
- The metadata values for: "board", "duration", "model"
- Bloom's Taxonomy level names if used (Remember, Understand, etc.)
- Subject and chapter names if originally in English

Use natural, grammatically correct ${language}. For technical/scientific terms, you may use English terminology where commonly understood (e.g., "DNA", "photosynthesis", "algorithm").

For Indian languages, use proper script (Devanagari for Hindi/Marathi, Tamil script for Tamil, etc.).
`;

  return `You are an expert CBSE-trained educator creating a professional 40-minute lesson plan using the 5E Instructional Model (Engage, Explore, Explain, Elaborate, Evaluate).

============================
CONTEXT
============================
- Curriculum Board: ${config.board}
- Class/Grade: ${config.classLevel}
- Subject: ${config.subject}
- Chapter: ${config.chapter}
- Specific Topic: ${config.topic || config.chapter}
- Total Duration: 40 minutes
- Output Language: ${language}
${config.learningObjective ? `- Teacher's specific learning objective: ${config.learningObjective}` : ''}
${config.teacherNotes ? `- Additional teacher notes: ${config.teacherNotes}` : ''}
${languageNote}

============================
5E MODEL TIME ALLOCATION (40 min total)
============================
- Engage: 5 minutes
- Explore: 8 minutes
- Explain: 12 minutes
- Elaborate: 10 minutes
- Evaluate: 5 minutes

============================
WHAT TO GENERATE
============================

Generate a complete, professional CBSE-style lesson plan with:

1. Clear learning objectives (3-4 measurable, Bloom's-aligned objectives)
2. Detailed materials & resources needed
3. Each 5E phase with specific activities and teacher dialogue
4. Differentiation strategies for slow & fast learners
5. Assessment methods
6. Homework assignment
7. Expected learning outcomes

============================
QUALITY GUIDELINES
============================

- Use age-appropriate language and examples for Class ${config.classLevel} students
- Include specific Indian context examples where relevant (Indian cities, real-life scenarios from Indian classrooms)
- Suggest concrete activities students can DO (not just listen)
- Provide actual sample questions teachers can ask
- Include realistic time estimates that add up to 40 minutes
- Make it immediately usable — no vague suggestions

============================
OUTPUT FORMAT
============================

Return ONLY valid JSON. No markdown, no backticks, no explanation. Start with { and end with }.

Use this exact structure:

{
  "title": "Topic Name",
  "metadata": {
    "board": "${config.board}",
    "class": "${config.classLevel}",
    "subject": "${config.subject}",
    "chapter": "${config.chapter}",
    "topic": "${config.topic || config.chapter}",
    "duration": "40 minutes",
    "model": "5E Instructional Model"
  },
  "learningObjectives": [
    "Students will be able to define... (Remember level)",
    "Students will be able to explain... (Understand level)",
    "Students will be able to apply... (Apply level)",
    "Students will be able to analyze... (Analyze level)"
  ],
  "materials": [
    "Whiteboard and markers",
    "Specific item 1 with details",
    "Specific item 2 with details",
    "NCERT textbook page references"
  ],
  "priorKnowledge": "What students should already know before this lesson (1-2 sentences)",
  "phases": {
    "engage": {
      "duration": "5 minutes",
      "purpose": "Hook students and activate prior knowledge",
      "activities": [
        "Specific activity 1 with details",
        "Specific activity 2 with details"
      ],
      "teacherDialogue": [
        "Sample question or statement teacher can use",
        "Another sample dialogue"
      ],
      "studentInvolvement": "What students will be doing during this phase"
    },
    "explore": {
      "duration": "8 minutes",
      "purpose": "Students investigate and discover concepts hands-on",
      "activities": [
        "Hands-on activity with specific instructions",
        "Investigation or discussion activity"
      ],
      "teacherDialogue": [
        "Guiding questions"
      ],
      "studentInvolvement": "Specific actions students take"
    },
    "explain": {
      "duration": "12 minutes",
      "purpose": "Formal teaching of concepts",
      "activities": [
        "Direct teaching points",
        "Diagrams to draw",
        "Examples to give"
      ],
      "keyContent": [
        "Concept 1: explanation",
        "Concept 2: explanation",
        "Important formula or definition"
      ],
      "teacherDialogue": [
        "Sample explanations teachers can use"
      ]
    },
    "elaborate": {
      "duration": "10 minutes",
      "purpose": "Apply learning to new contexts",
      "activities": [
        "Application exercise",
        "Real-world example or problem"
      ],
      "teacherDialogue": [
        "Discussion prompts to deepen understanding"
      ],
      "studentInvolvement": "How students apply concepts"
    },
    "evaluate": {
      "duration": "5 minutes",
      "purpose": "Check student understanding",
      "activities": [
        "Quick assessment activity",
        "Exit ticket or quick quiz"
      ],
      "assessmentQuestions": [
        "Sample question 1 with expected answer",
        "Sample question 2 with expected answer",
        "Sample question 3 with expected answer"
      ]
    }
  },
  "differentiation": {
    "forStrugglingLearners": [
      "Strategy 1 to support struggling students",
      "Strategy 2"
    ],
    "forAdvancedLearners": [
      "Extension activity 1",
      "Challenge problem"
    ]
  },
  "homework": {
    "description": "Brief description of homework assignment",
    "tasks": [
      "Specific task 1",
      "Specific task 2",
      "Specific task 3"
    ],
    "estimatedTime": "20-30 minutes"
  },
  "expectedOutcomes": [
    "By end of lesson, 80% of students will be able to...",
    "70% will be able to...",
    "60% will be able to..."
  ],
  "teacherTips": [
    "Practical tip 1 for delivering this lesson",
    "Common student misconception to watch for",
    "Backup plan if activity runs short"
  ],
  "nextLessonPreview": "Brief preview of what comes next (1-2 sentences)"
}

${language !== 'English' ? `\nFINAL REMINDER: All text content (objectives, activities, dialogue, tips, etc.) MUST be in ${language}. Use natural ${language} phrasing that an Indian teacher would actually use in a classroom.` : ''}`;
}
