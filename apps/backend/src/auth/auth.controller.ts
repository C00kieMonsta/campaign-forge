import { Controller, Post, Body, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { compare } from "bcryptjs";
import { sign } from "jsonwebtoken";
import { z } from "zod";
import { ConfigService } from "../config/config.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const credentialsSchema = z.array(z.object({ email: z.string(), hash: z.string() }));

const JWT_TTL = "8h";

@Controller("admin/auth")
export class AuthController {
  constructor(private config: ConfigService) {}

  @Post("login")
  async login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid request");

    const { email, password } = parsed.data;

    const rawCredentials = this.config.get("ADMIN_CREDENTIALS");
    const credentials = credentialsSchema.parse(JSON.parse(rawCredentials));

    const admin = credentials.find((c) => c.email.toLowerCase() === email.toLowerCase());
    const passwordMatch = admin ? await compare(password, admin.hash) : false;

    if (!admin || !passwordMatch) throw new UnauthorizedException("Invalid credentials");

    const token = sign({ email: admin.email }, this.config.get("JWT_SECRET"), { expiresIn: JWT_TTL });

    console.log(JSON.stringify({ level: "info", action: "adminLogin", email: admin.email }));
    return { ok: true, token };
  }
}
