import { Controller, Get, Post, Query, Body, BadRequestException, Res } from "@nestjs/common";
import { Response } from "express";
import { subscribeRequestSchema, unsubscribeQuerySchema, type Contact } from "@packages/types";
import { ContactsService } from "../contacts/contacts.service";
import { TokenService } from "../shared/token.service";

@Controller("public")
export class PublicController {
  constructor(
    private contacts: ContactsService,
    private token: TokenService,
  ) {}

  @Post("subscribe")
  async subscribe(@Body() body: unknown) {
    const parsed = subscribeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(", "));

    const { email, firstName, lastName } = parsed.data;
    const emailLower = email.toLowerCase().trim();

    const existing = await this.contacts.get(emailLower);
    if (existing) {
      return { ok: true, message: existing.status === "subscribed" ? "Already subscribed" : "Contact exists" };
    }

    const now = new Date().toISOString();
    const formattedDate = new Date(now).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const contact: Contact = {
      emailLower, email,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      notes: `Inscription à la newsletter le ${formattedDate}`,
      status: "subscribed", source: "landing",
      createdAt: now, updatedAt: now,
    };

    try {
      await this.contacts.createConditional(contact);
    } catch (err) {
      if ((err as Error).name === "ConditionalCheckFailedException") {
        return { ok: true, message: "Already subscribed" };
      }
      throw err;
    }

    console.log(JSON.stringify({ level: "info", action: "subscribed", emailLower }));
    return { ok: true, message: "Subscribed" };
  }

  @Get("unsubscribe")
  async unsubscribe(@Query("token") tokenStr: string, @Res() res: Response) {
    const parsed = unsubscribeQuerySchema.safeParse({ token: tokenStr });
    if (!parsed.success) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(400).send(errorPage("Invalid or missing token."));
    }

    const result = this.token.verify(parsed.data.token);
    if (!result.valid) {
      const msg = result.error === "expired" ? "This link has expired." : "Invalid link.";
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(400).send(errorPage(msg));
    }

    try {
      await this.contacts.update(result.emailLower, { status: "unsubscribed", unsubscribedAt: new Date().toISOString() });
      console.log(JSON.stringify({ level: "info", action: "unsubscribed", emailLower: result.emailLower }));
    } catch (err) {
      console.log(JSON.stringify({ level: "error", action: "unsubscribeFailed", emailLower: result.emailLower, error: String(err) }));
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(successPage());
  }
}

function successPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.c{text-align:center;padding:40px;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px}</style></head>
<body><div class="c"><div style="font-size:48px">✓</div><h1>Unsubscribed</h1><p>You've been removed from our mailing list.</p></div></body></html>`;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.c{text-align:center;padding:40px;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px}h1{color:#d32f2f}</style></head>
<body><div class="c"><h1>Error</h1><p>${msg}</p></div></body></html>`;
}
