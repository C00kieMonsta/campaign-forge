export const TEMPLATE_VARS = [
  { key: "firstName", token: "{{firstName}}" },
  { key: "lastName", token: "{{lastName}}" },
  { key: "displayName", token: "{{displayName}}" },
  { key: "email", token: "{{email}}" },
  { key: "organization", token: "{{organization}}" },
] as const;

export const SAMPLE_DATA: Record<string, string> = {
  "{{firstName}}": "Marie",
  "{{lastName}}": "Dupont",
  "{{displayName}}": "Marie Dupont",
  "{{email}}": "marie.dupont@example.com",
  "{{organization}}": "Acme Corp",
};

export const EMAIL_TEMPLATES = [
  {
    key: "simple" as const,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333333; line-height: 1.6;">
  <p>Bonjour {{firstName}},</p>
  <p>Votre message ici.</p>
  <p>Cordialement,<br>Monique Pirson</p>
</div>`,
  },
  {
    key: "promo" as const,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
  <div style="background-color: #c0603a; padding: 32px 24px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Titre de la promotion</h1>
  </div>
  <div style="padding: 32px 24px;">
    <p style="color: #555555; font-size: 16px; margin: 0 0 16px 0;">Bonjour {{firstName}},</p>
    <p style="color: #555555; font-size: 16px; line-height: 1.7; margin: 0 0 24px 0;">Décrivez votre offre ici.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="#" style="background-color: #c0603a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">Découvrir l'offre</a>
    </div>
    <p style="color: #888888; font-size: 14px; margin: 24px 0 0 0;">Cordialement,<br>Monique Pirson</p>
  </div>
</div>`,
  },
  {
    key: "newsletter" as const,
    html: `<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
  <div style="border-bottom: 3px solid #c0603a; padding: 32px 24px; text-align: center;">
    <h1 style="color: #333333; margin: 0; font-size: 26px;">Titre de la newsletter</h1>
    <p style="color: #888888; font-size: 14px; margin: 8px 0 0 0;">Bonjour {{firstName}},</p>
  </div>
  <div style="padding: 32px 24px;">
    <h2 style="color: #c0603a; font-size: 20px; margin: 0 0 12px 0;">Actualité 1</h2>
    <p style="color: #555555; line-height: 1.8; margin: 0 0 24px 0;">Contenu de votre première actualité...</p>
    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 24px 0;">
    <h2 style="color: #c0603a; font-size: 20px; margin: 0 0 12px 0;">Actualité 2</h2>
    <p style="color: #555555; line-height: 1.8; margin: 0;">Contenu de votre deuxième actualité...</p>
  </div>
</div>`,
  },
];

export const groupColorMap: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-green-100 text-green-700 border-green-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
};
