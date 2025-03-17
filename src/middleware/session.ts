import { Context } from 'telegraf';
import { pool } from '../config/database';
import { BotContext } from '../types';

export async function PostgresSession(ctx: BotContext, next: () => Promise<void>) {
  if (!ctx.from?.id) {
    return next();
  }

  const userId = ctx.from.id;
  const chatId = ctx.chat?.id || userId;

  try {
    // Try to get existing session
    const result = await pool.query(
      'SELECT session_data FROM bot_sessions WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length > 0) {
      ctx.session = result.rows[0].session_data;
    } else {
      ctx.session = {};
    }

    // Store original session
    const originalSession = JSON.stringify(ctx.session);

    await next();

    // Check if session was modified
    if (JSON.stringify(ctx.session) !== originalSession) {
      if (Object.keys(ctx.session || {}).length === 0) {
        // Delete session if empty
        await pool.query(
          'DELETE FROM bot_sessions WHERE user_id = $1',
          [userId]
        );
      } else {
        // Upsert session data
        await pool.query(`
          INSERT INTO bot_sessions (user_id, chat_id, session_data, updated_at)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id)
          DO UPDATE SET
            session_data = $3,
            updated_at = CURRENT_TIMESTAMP
        `, [userId, chatId, ctx.session]);
      }
    }
  } catch (error) {
    console.error('Session middleware error:', error);
    ctx.session = {};
    await next();
  }
} 