/**
 * Ameo Unified Server
 * Serves:
 * 1. Static assets (sprites)
 * 2. AI feedback via OpenAI GPT-4o API
 * 3. Daily speech generation via OpenAI GPT-4o
 * 4. Messaging system via PostgreSQL
 *
 * Deploy to Railway:
 * 1. Set OPENAI_API_KEY environment variable
 * 2. Set DATABASE_URL for PostgreSQL (optional, for messaging)
 * 3. Run: npm install express cors dotenv pg
 * 4. Run: node server.js
 */

const express = require("express");
const path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Daily speeches cache
let cachedSpeeches = null;
let cachedDate = "";

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname)));

// ============================================
// Speech Generation Configuration
// ============================================

const SPEECH_CATEGORIES = {
  general_tech_roasts: "General Tech Roasts",
  ai_news: "AI News",
  figma: "Figma",
  science: "Science",
  games: "Games",
  design_tools: "Design Tools"
};

const FALLBACK_SPEECHES = {
  general_tech_roasts: [
    "You call *that* code?",
    "Have you tried Stack Overflow?",
    "That's why we have code review.",
  ],
  ai_news: [
    "AI is coming for your job.",
    "Another AI startup. Groundbreaking.",
    "ChatGPT wrote this better.",
  ],
  figma: [
    "Your design system needs a design system.",
    "Figma crashed again? Classic.",
    "That component library is... something.",
  ],
  science: [
    "According to science, you should sleep.",
    "Physics disagrees with your approach.",
    "The laws of thermodynamics called.",
  ],
  games: [
    "Speedrun through the tutorial? Bold.",
    "That's a skill issue.",
    "Press F to respect.",
  ],
  design_tools: [
    "Another design tool emerges.",
    "Better tools won't fix bad design.",
    "Your design needs work, not tools.",
  ]
};

// ============================================
// Health Check
// ============================================

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================
// List Available Assets
// ============================================

app.get("/", (req, res) => {
  const fs = require("fs");
  const assetsDir = path.join(__dirname);

  try {
    const files = fs.readdirSync(assetsDir).filter((file) => {
      const stat = fs.statSync(path.join(assetsDir, file));
      return stat.isFile() && !file.startsWith(".");
    });

    res.json({ 
      status: "ok",
      assets: files,
      message: "Access files directly: /sprite-idle-01.png, etc."
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to list assets" });
  }
});

// ============================================
// Daily Speech Generation API (GPT-4o)
// ============================================

app.get("/api/speech/daily", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Return cached if same day
    if (cachedDate === today && cachedSpeeches) {
      console.log(`📦 Returning cached speeches for ${today}`);
      return res.json({
        date: today,
        categories: cachedSpeeches,
        cached: true,
        lastFetched: Date.now()
      });
    }

    // Generate new speeches if different day
    console.log(`✨ Generating new speeches for ${today}`);
    const speeches = await generateDailySpeeches();

    // Update cache
    cachedSpeeches = speeches;
    cachedDate = today;

    res.json({
      date: today,
      categories: speeches,
      cached: false,
      lastFetched: Date.now()
    });

  } catch (error) {
    console.error("Error in /api/speech/daily:", error.message);
    res.status(500).json({
      error: "Failed to generate speeches",
      message: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// ============================================
// Generate Daily Speeches (GPT-4o)
// ============================================

async function generateDailySpeeches() {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.warn("⚠️ OPENAI_API_KEY not set, using fallback speeches");
    return FALLBACK_SPEECHES;
  }

  try {
    const prompt = generateSpeechPrompt();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`OpenAI API error (${response.status}):`, errorData);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Parse JSON response
    const aiSpeeches = JSON.parse(content);

    // Validate and combine with fallback
    return validateAndCombineSpeeches(aiSpeeches);

  } catch (error) {
    console.error("❌ Failed to generate speeches with GPT-4o:", error.message);
    console.log("🔄 Falling back to hardcoded speeches");
    return FALLBACK_SPEECHES;
  }
}

function generateSpeechPrompt() {
  const categoriesDescription = Object.entries(SPEECH_CATEGORIES)
    .map(([key, value]) => `- ${value} (${key})`)
    .join("\n");

  return `You are a sarcastic design assistant cat. Generate exactly 4 NEW witty speech bubbles for EACH category below.

Each speech bubble should:
- Be max 130 characters
- Be funny, sarcastic, or clever
- Be unique (don't repeat common jokes)
- Match the category theme
- Reference the topic naturally

Categories:
${categoriesDescription}

Today's context: These speeches should reference current trends and general knowledge about these topics.

Return ONLY valid JSON (no markdown, no explanation, no code blocks):
{
  "general_tech_roasts": ["speech1", "speech2", "speech3", "speech4"],
  "ai_news": ["speech1", "speech2", "speech3", "speech4"],
  "figma": ["speech1", "speech2", "speech3", "speech4"],
  "science": ["speech1", "speech2", "speech3", "speech4"],
  "games": ["speech1", "speech2", "speech3", "speech4"],
  "design_tools": ["speech1", "speech2", "speech3", "speech4"]
}`;
}

function validateAndCombineSpeeches(aiSpeeches) {
  const combined = {};

  for (const [category, fallback] of Object.entries(FALLBACK_SPEECHES)) {
    const aiList = aiSpeeches[category] || [];

    // Validate AI speeches
    const validAiSpeeches = aiList.filter(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 130
    );

    // Combine: fallback (1-2) + AI (up to 4) = max 5 per category
    const all = [...(fallback || []), ...validAiSpeeches];
    combined[category] = all.slice(0, 5);

    // Log if we had to use fallback
    if (validAiSpeeches.length < 4) {
      console.warn(`⚠️ Category "${category}" only got ${validAiSpeeches.length} valid AI speeches, using fallback`);
    }
  }

  return combined;
}

// ============================================
// AI Feedback API (DeepSeek)
// ============================================

app.post("/api/feedback", async (req, res) => {
  try {
    const { frames } = req.body;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid frames array",
      });
    }

    console.log(`Processing feedback for ${frames.length} frame(s)`);
    // Log what we received from the plugin
    frames.forEach((frame, idx) => {
      console.log(`   [${idx}] ${frame.frameData.name} - ${frame.svgBase64 ? `PNG (${frame.svgBase64.length} chars)` : 'No PNG'}`);
    });

    const feedbackList = [];
    for (const frame of frames) {
      try {
        const feedbackArray = await generateDesignFeedback(frame.frameData);
        // feedbackArray is now an array of feedback items
        feedbackArray.forEach((feedback) => {
          feedbackList.push({
            frameId: frame.frameId,
            feedback: feedback.feedback,
            category: feedback.category,
            confidence: feedback.confidence,
          });
        });
        console.log(`Feedback generated for: "${frame.frameData.name}" (${feedbackArray.length} points)`);
      } catch (frameError) {
        console.error(`Error processing frame ${frame.frameId}:`, frameError.message);
        feedbackList.push({
          frameId: frame.frameId,
          feedback: "Unable to generate feedback at this time",
          category: "general",
          confidence: 0,
        });
      }
    }

    res.json(feedbackList);
  } catch (error) {
    console.error("Feedback API error:", error.message);
    res.status(500).json({
      error: "Failed to generate feedback",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// AI Feedback Implementation (OpenAI GPT-4o)
// ============================================

async function generateDesignFeedback(frameData) {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.warn("OpenAI API key not configured, using simple feedback");
    return generateSimpleFeedback(frameData);
  }

  try {
    // Build base prompt
    let textContent = `You are Ameo, a friendly UX/UI design expert cat. Analyze this Figma frame and provide detailed, specific feedback.

Frame: ${frameData.name} (${frameData.width}x${frameData.height}px)
Has colors: ${frameData.fills ? frameData.fills.length > 0 : false}
Has borders: ${frameData.strokes ? frameData.strokes.length > 0 : false}`;

    // Check if frame is empty
    const isEmpty = !frameData.fills || frameData.fills.length === 0;

    // Build message content array (for GPT-4o vision)
    const messageContent = [];
    let hasImage = false;

    if (frameData.svgBase64) {
      // Debug: show what we're checking
      const first20 = frameData.svgBase64.substring(0, 20);
      console.log(`🔍 svgBase64 starts with: "${first20}..."`);
      console.log(`   Is FRAME_CONTENT: ${frameData.svgBase64.startsWith("FRAME_CONTENT:")}`);
      console.log(`   Is PNG (iVBORw0KGgo): ${frameData.svgBase64.startsWith("iVBORw0KGgo")}`);

      // Check if it's a frame content descriptor or PNG/SVG
      if (frameData.svgBase64.startsWith("FRAME_CONTENT:")) {
        // Decode and use frame content description
        console.log(`📝 Frame has content description (${frameData.svgBase64.length} chars)`);
        try {
          const decoded = Buffer.from(frameData.svgBase64, "base64").toString("utf-8");
          const contentDesc = decoded.replace("FRAME_CONTENT:", "");
          textContent += `

FRAME STRUCTURE & CONTENT:
${contentDesc}

Analyze the frame content and structure above. Provide feedback on:
1. Layout and organization of elements
2. Content hierarchy and visual balance
3. Spacing and alignment consistency
4. Typography and text hierarchy (if applicable)
5. Suggestions for improvement`;
        } catch (e) {
          textContent += `

Frame content description available. Analyzing...`;
        }
      } else if (frameData.svgBase64.startsWith("iVBORw0KGgo")) {
        // PNG format (base64 PNG always starts with iVBORw0KGgo)
        // Use GPT-4o vision API with image_url content
        console.log(`🖼️ Frame has PNG image (${frameData.svgBase64.length} chars base64) - will send to GPT-4o vision API`);
        textContent += `

Analyze the PNG screenshot of the frame above and provide detailed feedback on:
1. Visual layout and composition of elements
2. Spacing and alignment between elements
3. Color usage, contrast, and visual hierarchy
4. Typography and text readability
5. Design quality and specific improvement opportunities`;

        // Add image to content array for vision API
        messageContent.push({
          type: "text",
          text: textContent
        });
        messageContent.push({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${frameData.svgBase64}`
          }
        });
        hasImage = true;
      } else {
        // SVG or other format
        textContent += `

VISUAL DESIGN (SVG):
data:image/svg+xml;base64,${frameData.svgBase64}

Analyze the SVG visual representation above and provide feedback on:
1. Visual layout and composition
2. Spacing and alignment
3. Color usage and contrast (if applicable)
4. Visual hierarchy and visual balance
5. Any design inconsistencies or improvement opportunities`;
      }
    } else if (isEmpty) {
      textContent += `

NOTE: This frame appears to be empty or blank. Provide feedback on:
1. Suggested purpose for this frame
2. What type of content could work well here
3. Recommended dimensions and structure
4. Design considerations for this frame's intended use`;
    } else {
      textContent += `

Analyze the frame based on metadata and provide feedback on design aspects.`;
    }

    textContent += `

Provide feedback as a JSON array with 3-4 specific, actionable comments. Each comment should be 1-2 sentences and friendly.

Respond with ONLY JSON array (no markdown, no extra text):
[
  {
    "feedback": "Specific feedback about what you observe",
    "category": "category_name"
  }
]

Use these categories as appropriate: layout, spacing, color, typography, accessibility, general`;

    // If no image was added, use text content directly
    if (!hasImage) {
      messageContent.push({
        type: "text",
        text: textContent
      });
    }

    // Log what we're sending to OpenAI
    console.log(`📤 Sending to OpenAI: ${messageContent.length} content items (${hasImage ? 'with PNG' : 'text only'})`);
    messageContent.forEach((item, idx) => {
      if (item.type === 'text') {
        console.log(`   [${idx}] TEXT (${item.text.length} chars)`);
      } else if (item.type === 'image_url') {
        console.log(`   [${idx}] IMAGE_URL (data:image/png;base64,${item.image_url.url.substring(0, 50)}...)`);
      }
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`OpenAI API error (${response.status}):`, errorData);
      throw new Error(`OpenAI API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Invalid OpenAI response structure:", data);
      throw new Error("Invalid response from OpenAI API");
    }
    const content = data.choices[0].message.content;
    console.log(`OpenAI response (${content.length} chars)`);

    // Try to parse as array (multiple feedback points)
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        // Return array of feedback items
        return parsed.map((item) => ({
          feedback: item.feedback || "Nice design!",
          category: item.category || "general",
          confidence: item.confidence || 0.8,
        }));
      }
    }

    // Fallback to single feedback object
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const parsed = JSON.parse(objMatch[0]);
      return [{
        feedback: parsed.feedback || "Nice design!",
        category: parsed.category || "general",
        confidence: parsed.confidence || 0.8,
      }];
    }

    // If no JSON found, return single generic feedback
    return [{
      feedback: content,
      category: "general",
      confidence: 0.75,
    }];
  } catch (error) {
    console.error("OpenAI error:", error.message);
    return generateSimpleFeedback(frameData);
  }
}

// Simple rule-based feedback (fallback)
function generateSimpleFeedback(frameData) {
  const feedback_list = [
    { feedback: "Great design! Consider testing on different screen sizes.", category: "layout" },
    { feedback: "Nice work! Ensure sufficient contrast for accessibility.", category: "accessibility" },
    { feedback: "Clean layout! Make sure spacing is consistent.", category: "spacing" },
    { feedback: "Good visual design! Consider the user experience on mobile.", category: "responsive" },
  ];

  // Return as array (consistent with API expectations)
  return [
    {
      feedback: feedback_list[Math.floor(Math.random() * feedback_list.length)].feedback,
      category: feedback_list[Math.floor(Math.random() * feedback_list.length)].category,
      confidence: 0.7 + Math.random() * 0.2,
    }
  ];
}

// ============================================
// Database Initialization
// ============================================

async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        cat_name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create conversations table
    // Drop if exists with bad schema
    try {
      await pool.query(`DROP TABLE IF EXISTS conversations CASCADE;`);
    } catch (e) {
      // Ignore if table doesn't exist
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

// ============================================
// Messaging API Endpoints
// ============================================

// Register or get user by cat name
app.post("/api/messages/register", async (req, res) => {
  try {
    const { cat_name } = req.body;

    if (!cat_name || cat_name.trim().length === 0) {
      return res.status(400).json({ error: "Cat name is required" });
    }

    // Check if user already exists
    let result = await pool.query("SELECT id FROM users WHERE cat_name = $1", [cat_name]);

    if (result.rows.length > 0) {
      return res.json({ id: result.rows[0].id, cat_name, created: false });
    }

    // Create new user
    result = await pool.query(
      "INSERT INTO users (cat_name) VALUES ($1) RETURNING id, cat_name, created_at",
      [cat_name]
    );

    res.json({ id: result.rows[0].id, cat_name: result.rows[0].cat_name, created: true });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// IMPORTANT: Specific routes MUST come before generic routes with same parameter count
// Otherwise /api/messages/unread/:name will match /:user/:other pattern

// Check if cat name exists
app.get("/api/messages/check-name/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const result = await pool.query("SELECT id FROM users WHERE cat_name = $1", [name]);
    res.json({ exists: result.rows.length > 0, id: result.rows[0]?.id || null });
  } catch (error) {
    console.error("Check name error:", error.message);
    res.status(500).json({ error: "Failed to check cat name" });
  }
});

// Get all conversations for a user (must come before :user/:other pattern)
app.get("/api/messages/list/:user_cat_name", async (req, res) => {
  try {
    const { user_cat_name } = req.params;

    const userResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      user_cat_name,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    // Get all conversations with latest message
    const convResult = await pool.query(
      `SELECT
        c.id,
        CASE
          WHEN c.user1_id = $1 THEN u2.cat_name
          ELSE u1.cat_name
        END as other_cat_name,
        CASE
          WHEN c.user1_id = $1 THEN c.user2_id
          ELSE c.user1_id
        END as other_user_id,
        (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
        COALESCE((SELECT COUNT(*)::INTEGER FROM messages m WHERE m.conversation_id = c.id AND m.is_read = FALSE AND m.sender_id != $1), 0) as unread_count
       FROM conversations c
       JOIN users u1 ON c.user1_id = u1.id
       JOIN users u2 ON c.user2_id = u2.id
       WHERE c.user1_id = $1 OR c.user2_id = $1
       ORDER BY last_message_time DESC NULLS LAST`,
      [userId]
    );

    res.json({ conversations: convResult.rows });
  } catch (error) {
    console.error("Get conversations error:", error.message);
    res.status(500).json({ error: "Failed to get conversations" });
  }
});

// Get unread count (must come before :user/:other pattern)
app.get("/api/messages/unread/:user_cat_name", async (req, res) => {
  try {
    const { user_cat_name } = req.params;

    const userResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      user_cat_name,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT COUNT(*) as unread_count
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.user1_id = $1 OR c.user2_id = $1)
       AND m.sender_id != $1
       AND m.is_read = FALSE`,
      [userId]
    );

    res.json({ unread_count: parseInt(result.rows[0].unread_count) });
  } catch (error) {
    console.error("Get unread count error:", error.message);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// Send a message
app.post("/api/messages/send", async (req, res) => {
  try {
    const { sender_cat_name, recipient_cat_name, content } = req.body;

    if (!sender_cat_name || !recipient_cat_name || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get user IDs
    const senderResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      sender_cat_name,
    ]);
    const recipientResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      recipient_cat_name,
    ]);

    if (senderResult.rows.length === 0 || recipientResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const senderId = senderResult.rows[0].id;
    const recipientId = recipientResult.rows[0].id;

    // Get or create conversation
    let convResult = await pool.query(
      `SELECT id FROM conversations
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [senderId, recipientId]
    );

    let conversationId;
    if (convResult.rows.length === 0) {
      convResult = await pool.query(
        "INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id",
        [senderId, recipientId]
      );
      conversationId = convResult.rows[0].id;
    } else {
      conversationId = convResult.rows[0].id;
    }

    // Insert message
    const msgResult = await pool.query(
      "INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, created_at",
      [conversationId, senderId, content]
    );

    res.json({ id: msgResult.rows[0].id, created_at: msgResult.rows[0].created_at });
  } catch (error) {
    console.error("Send message error:", error.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Get conversation with a specific user
app.get("/api/messages/:user_cat_name/:other_cat_name", async (req, res) => {
  try {
    const { user_cat_name, other_cat_name } = req.params;

    // Get user IDs
    const userResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      user_cat_name,
    ]);
    const otherResult = await pool.query("SELECT id FROM users WHERE cat_name = $1", [
      other_cat_name,
    ]);

    if (userResult.rows.length === 0 || otherResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;
    const otherId = otherResult.rows[0].id;

    // Get conversation
    const convResult = await pool.query(
      `SELECT id FROM conversations
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [userId, otherId]
    );

    if (convResult.rows.length === 0) {
      return res.json({ messages: [], otherUserInfo: { cat_name: other_cat_name, id: otherId } });
    }

    const conversationId = convResult.rows[0].id;

    // Get all messages and mark as read
    const msgResult = await pool.query(
      `SELECT m.id, m.content, m.sender_id, m.created_at, u.cat_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    // Mark unread messages as read
    await pool.query(
      "UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id = $2",
      [conversationId, otherId]
    );

    res.json({
      messages: msgResult.rows,
      otherUserInfo: { cat_name: other_cat_name, id: otherId },
    });
  } catch (error) {
    console.error("Get conversation error:", error.message);
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

// ============================================
// 404 Handler
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    available: ["/health", "/", "GET /api/speech/daily", "POST /api/feedback", "POST /api/messages/register", "GET /api/messages/list/:cat_name"],
  });
});

// ============================================
// Start Server
// ============================================

async function startServer() {
  // Initialize database if DATABASE_URL is configured
  if (process.env.DATABASE_URL) {
    await initializeDatabase();
  } else {
    console.warn("DATABASE_URL not set - messaging features will not work");
  }

  app.listen(PORT, () => {
    console.log(`Ameo Assets Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

module.exports = app;
