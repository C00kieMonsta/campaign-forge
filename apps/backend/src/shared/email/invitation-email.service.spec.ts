import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { InvitationEmailService } from "@/shared/email/invitation-email.service";
import { sesClient } from "@/shared/email/ses-client";

jest.mock("@/shared/email/ses-client", () => ({
  sesClient: {
    send: jest.fn()
  }
}));

describe("InvitationEmailService", () => {
  let service: InvitationEmailService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationEmailService,
        {
          provide: ConfigService,
          useValue: {
            getString: jest.fn().mockReturnValue("noreply@test.com")
          }
        }
      ]
    }).compile();

    service = module.get<InvitationEmailService>(InvitationEmailService);
    configService = module.get(ConfigService);
    jest.clearAllMocks();
  });

  describe("sendInvitationEmail", () => {
    it("should send invitation email successfully", async () => {
      const request = {
        recipientEmail: "invited@example.com",
        organizationName: "Test Org",
        roleName: "Admin",
        inviterName: "John Doe",
        invitationToken: "token-123",
        frontendUrl: "http://localhost:8000"
      };

      (sesClient.send as jest.Mock).mockResolvedValue({
        MessageId: "msg-123"
      });

      const result = await service.sendInvitationEmail(request);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg-123");
      expect(sesClient.send).toHaveBeenCalled();
    });

    it("should handle email sending errors", async () => {
      const request = {
        recipientEmail: "invited@example.com",
        organizationName: "Test Org",
        roleName: "Admin",
        inviterName: "John Doe",
        invitationToken: "token-123",
        frontendUrl: "http://localhost:8000"
      };

      (sesClient.send as jest.Mock).mockRejectedValue(new Error("SES error"));

      const result = await service.sendInvitationEmail(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe("SES error");
    });

    it("should generate correct invitation URL", async () => {
      const request = {
        recipientEmail: "invited@example.com",
        organizationName: "Test Org",
        roleName: "Admin",
        inviterName: "John Doe",
        invitationToken: "token-123",
        frontendUrl: "http://localhost:8000"
      };

      (sesClient.send as jest.Mock).mockResolvedValue({
        MessageId: "msg-123"
      });

      await service.sendInvitationEmail(request);

      const sendCall = (sesClient.send as jest.Mock).mock.calls[0][0];
      const htmlBody = sendCall.input.Message.Body.Html.Data;

      expect(htmlBody).toContain(
        `http://localhost:8000/auth/register?token=token-123&email=${encodeURIComponent(request.recipientEmail)}`
      );
    });
  });
});
