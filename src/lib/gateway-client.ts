/**
 * Gateway client for starkbot instance API.
 * Ported from starkbot-ext-cli/src/client.rs
 */

export interface ChatResponse {
  success: boolean;
  response: string | null;
  session_id: number | null;
  error: string | null;
}

export interface SessionInfo {
  id: number;
  session_key: string;
  created_at: string;
  last_activity_at: string;
  message_count: number;
}

export interface SessionsResponse {
  success: boolean;
  sessions: SessionInfo[];
}

export interface MessageInfo {
  role: string;
  content: string;
  user_name: string | null;
  created_at: string;
}

export interface MessagesResponse {
  success: boolean;
  messages: MessageInfo[];
}

export interface NewSessionResponse {
  success: boolean;
  session_id: number;
}

export interface SseEvent {
  type: string;
  content?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  success?: boolean;
  duration_ms?: number;
  label?: string;
  agent_subtype?: string;
  error?: string;
  task_name?: string;
}

export class GatewayClient {
  private baseUrl: string;
  private token: string;
  public sessionId: string | undefined;

  constructor(baseUrl: string, token: string, sessionId?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.sessionId = sessionId;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private chatBody(message: string) {
    return {
      message,
      ...(this.sessionId ? { session_id: this.sessionId } : {}),
    };
  }

  /** Send a message and get the full response */
  async chat(message: string): Promise<ChatResponse> {
    const url = `${this.baseUrl}/api/gateway/chat`;
    const resp = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.chatBody(message)),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    return resp.json() as Promise<ChatResponse>;
  }

  /** Send a message and stream SSE events */
  async chatStream(
    message: string,
    onEvent: (event: SseEvent) => void
  ): Promise<void> {
    const url = `${this.baseUrl}/api/gateway/chat/stream`;
    const resp = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.chatBody(message)),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    if (!resp.body) throw new Error("No response body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE frames (separated by double newline)
      let pos: number;
      while ((pos = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 2);

        for (const line of frame.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as SseEvent;
              const isDone = event.type === "done";
              onEvent(event);
              if (isDone) return;
            } catch {
              // skip malformed events
            }
          }
        }
      }
    }
  }

  /** Create a new session */
  async newSession(): Promise<NewSessionResponse> {
    const url = `${this.baseUrl}/api/gateway/sessions/new`;
    const resp = await fetch(url, {
      method: "POST",
      headers: this.headers(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    return resp.json() as Promise<NewSessionResponse>;
  }

  /** List sessions */
  async listSessions(): Promise<SessionsResponse> {
    const url = `${this.baseUrl}/api/gateway/sessions`;
    const resp = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    return resp.json() as Promise<SessionsResponse>;
  }

  /** Get message history for a session */
  async getHistory(sessionId: number): Promise<MessagesResponse> {
    const url = `${this.baseUrl}/api/gateway/sessions/${sessionId}/messages`;
    const resp = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    return resp.json() as Promise<MessagesResponse>;
  }

  /** Simple health check */
  async ping(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/health`, {
        headers: this.headers(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
