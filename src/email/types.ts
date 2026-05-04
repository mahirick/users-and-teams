// Email transport contract. Console (dev), Resend (prod), SMTP (future) all
// implement this. Operations module is transport-agnostic — pass any of these
// to authPlugin / teamsPlugin.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
