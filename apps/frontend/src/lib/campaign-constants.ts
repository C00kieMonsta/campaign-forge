const IMAGE_PLACEHOLDER = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2YwZjBmMCIgcng9IjgiLz48dGV4dCB4PSIzMDAiIHk9IjEwOCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjIwIiBmaWxsPSIjYWFhYWFhIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5a877iPIFZvdHJlIGltYWdlIGljaTwvdGV4dD48L3N2Zz4=`;
const IMG_PLACEHOLDER_HTML = `<img src="${IMAGE_PLACEHOLDER}" alt="Votre image ici" style="width:100%;max-width:600px;display:block;margin:16px auto;border-radius:8px;cursor:pointer;" />`;

export const TEMPLATE_VARS = [
  { key: "firstName", token: "{{firstName}}" },
  { key: "lastName", token: "{{lastName}}" },
  { key: "displayName", token: "{{displayName}}" },
  { key: "email", token: "{{email}}" },
  { key: "organization", token: "{{organization}}" }
] as const;

export const SAMPLE_DATA: Record<string, string> = {
  "{{firstName}}": "Marie",
  "{{lastName}}": "Dupont",
  "{{displayName}}": "Marie Dupont",
  "{{email}}": "marie.dupont@example.com",
  "{{organization}}": "Acme Corp"
};

export const EMAIL_TEMPLATES = [
  {
    key: "simple" as const,
    html: `<p>Bonjour {{firstName}},</p><p>Votre message ici.</p><p>Cordialement,<br>Monique Pirson</p>`
  },
  {
    key: "promo" as const,
    html: `<h1 style="text-align: center"><span style="color: #558B2F">Titre de la promotion</span></h1><p>Bonjour {{firstName}},</p>${IMG_PLACEHOLDER_HTML}<p>Décrivez votre offre ici.</p><p style="text-align: center"><a href="#">Découvrir l'offre →</a></p><p>Cordialement,<br>Monique Pirson</p>`
  },
  {
    key: "newsletter" as const,
    html: `<h1>Titre de la newsletter</h1><p>Bonjour {{firstName}},</p><h2><span style="color: #558B2F">Actualité 1</span></h2><p>Contenu de votre première actualité...</p><hr><h2><span style="color: #558B2F">Actualité 2</span></h2><p>Contenu de votre deuxième actualité...</p><p>Cordialement,<br>Monique Pirson</p>`
  },
  {
    key: "thermomixMonthly" as const,
    html: `<h1 style="text-align: center"><span style="color: #558B2F">Action du mois Thermomix®</span></h1><p>Bonjour {{firstName}},</p><p>Ce mois-ci, nous avons une <strong>offre spéciale Thermomix®</strong> que vous ne voudrez pas manquer ! Profitez de cette opportunité unique pour découvrir de nouvelles recettes et accessoires.</p><h2><span style="color: #558B2F">🎯 L'action du mois</span></h2><p>Décrivez ici les détails de votre action mensuelle...</p>${IMG_PLACEHOLDER_HTML}<p style="text-align: center"><a href="#">Découvrir l'action →</a></p><hr><h2>🍳 La recette du mois</h2><p>Ajoutez ici une recette exclusive préparée avec le Thermomix®...</p>${IMG_PLACEHOLDER_HTML}<p>Cordialement,<br>Monique Pirson</p>`
  },
  {
    key: "thermomixChristmas" as const,
    html: `<h1 style="text-align: center"><span style="color: #558B2F">🎄 Joyeux Noël avec Thermomix® !</span></h1><p>Bonjour {{firstName}},</p><p>La période des fêtes approche, et quoi de mieux que de préparer de <strong>délicieux repas de Noël</strong> avec votre Thermomix® ? Laissez-vous inspirer par nos recettes festives spécialement sélectionnées pour vous.</p><h2><span style="color: #558B2F">🎁 Notre offre de Noël</span></h2><p>Détaillez ici votre offre ou promotion de Noël...</p>${IMG_PLACEHOLDER_HTML}<h2>🍽️ Nos recettes de fêtes</h2><ul><li>Bûche de Noël au chocolat</li><li>Velouté de châtaignes</li><li>Saumon en croûte</li></ul><p style="text-align: center"><a href="#">Découvrir les recettes de Noël →</a></p><p>De tout cœur, Joyeux Noël ! 🎄<br>Monique Pirson</p>`
  },
  {
    key: "thermomixEaster" as const,
    html: `<h1 style="text-align: center"><span style="color: #558B2F">🐣 Joyeuses Pâques avec Thermomix® !</span></h1><p>Bonjour {{firstName}},</p><p>Le printemps est là, et Pâques avec lui ! C'est le moment de cuisiner des <strong>recettes fraîches et colorées</strong> avec votre Thermomix®. Laissez-vous inspirer par nos idées festives pour cette belle saison.</p><h2><span style="color: #558B2F">🥚 Notre offre de Pâques</span></h2><p>Décrivez ici votre offre ou promotion de Pâques...</p>${IMG_PLACEHOLDER_HTML}<h2>🌸 Idées recettes pour Pâques</h2><ul><li>Agneau de Pâques et ses légumes de printemps</li><li>Charlotte aux fraises</li><li>Œufs en chocolat maison</li></ul><p style="text-align: center"><a href="#">Découvrir les recettes de Pâques →</a></p><p>Joyeuses Pâques ! 🐣<br>Monique Pirson</p>`
  },
  {
    key: "thermomixPromoRecipe" as const,
    fullHtml: true as const,
    html: `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f2f2;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#558B2F;padding:36px 40px 32px;text-align:center;">
            <p style="margin:0 0 10px;color:rgba(255,255,255,0.7);font-size:12px;letter-spacing:2px;text-transform:uppercase;">Thermomix®</p>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:bold;line-height:1.4;">Les promos du moment<br>+ ma recette du mois</h1>
          </td>
        </tr>

        <!-- GREETING -->
        <tr>
          <td style="padding:36px 40px 0;">
            <p style="margin:0 0 10px;font-size:18px;color:#1a1a1a;font-weight:bold;">Bonjour {{firstName}},</p>
            <p style="margin:0 0 28px;font-size:15px;color:#555555;line-height:1.7;">Une belle offre Thermomix® ce mois-ci :</p>
          </td>
        </tr>

        <!-- PACK 1 -->
        <tr>
          <td style="padding:0 40px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-left:4px solid #558B2F;background-color:#f3f8ee;padding:18px 22px;border-radius:0 8px 8px 0;">
                  <p style="margin:0 0 4px;font-size:16px;font-weight:bold;color:#1a1a1a;">Pack [Nom du pack 1]</p>
                  <p style="margin:0 0 12px;font-size:13px;color:#888888;">TM7 + [accessoire 1] + [accessoire 2]</p>
                  <span style="font-size:22px;font-weight:bold;color:#558B2F;">[prix] €&nbsp;</span><span style="font-size:13px;color:#bbbbbb;text-decoration:line-through;">au lieu de [prix barré] €</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- PACK 2 -->
        <tr>
          <td style="padding:0 40px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-left:4px solid #558B2F;background-color:#f3f8ee;padding:18px 22px;border-radius:0 8px 8px 0;">
                  <p style="margin:0 0 4px;font-size:16px;font-weight:bold;color:#1a1a1a;">Pack [Nom du pack 2]</p>
                  <p style="margin:0 0 12px;font-size:13px;color:#888888;">TM7 + [accessoire 1] + [accessoire 2]</p>
                  <span style="font-size:22px;font-weight:bold;color:#558B2F;">[prix] €&nbsp;</span><span style="font-size:13px;color:#bbbbbb;text-decoration:line-through;">au lieu de [prix barré] €</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- VALIDITY NOTE -->
        <tr>
          <td style="padding:0 40px 28px;">
            <p style="margin:0;font-size:13px;color:#aaaaaa;font-style:italic;">Offres valables jusqu'au [date], avec possibilité de paiement en plusieurs fois sans frais.</p>
          </td>
        </tr>

        <!-- CTA BUTTONS -->
        <tr>
          <td style="padding:0 40px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding-right:8px;">
                  <a href="#" style="display:block;background-color:#558B2F;color:#ffffff;text-decoration:none;text-align:center;padding:17px 10px;border-radius:7px;font-size:14px;font-weight:bold;line-height:1.4;">Commander le<br>Pack [Nom 1] →</a>
                </td>
                <td width="50%" style="padding-left:8px;">
                  <a href="#" style="display:block;background-color:#558B2F;color:#ffffff;text-decoration:none;text-align:center;padding:17px 10px;border-radius:7px;font-size:14px;font-weight:bold;line-height:1.4;">Commander le<br>Pack [Nom 2] →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 40px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eeeeee;"></td></tr></table></td></tr>

        <!-- CONSULTANT -->
        <tr>
          <td style="padding:0 40px 28px;">
            <p style="margin:0;font-size:15px;color:#555555;line-height:1.75;">Par ailleurs, pour celles et ceux qui le souhaitent, il est toujours possible de rejoindre l'aventure Thermomix® en tant que conseiller(ère), et de financer votre appareil en le partageant autour de vous.</p>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 40px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eeeeee;"></td></tr></table></td></tr>

        <!-- RECIPE HEADER -->
        <tr>
          <td style="padding:0 40px 14px;">
            <h2 style="margin:0 0 14px;font-size:21px;color:#1a1a1a;">🍪 La recette du mois : [Nom de la recette]</h2>
            <p style="margin:0;font-size:15px;color:#555555;line-height:1.75;">Et pour terminer sur une note gourmande, je vous ai préparé une petite surprise : une recette de <strong>[Nom de la recette]</strong>, testée et adorée à la maison. Vous pourrez l'ajouter directement à votre compte Cookidoo.</p>
          </td>
        </tr>

        <!-- RECIPE IMAGE -->
        <tr>
          <td style="padding:16px 40px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background-color:#f5f5f5;border-radius:8px;padding:56px 20px;">
                  <p style="margin:0;color:#cccccc;font-size:15px;">📷 Votre photo de recette ici</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- COOKIDOO BUTTON -->
        <tr>
          <td style="padding:0 40px 36px;text-align:center;">
            <a href="#" style="display:inline-block;background-color:#3a3a3a;color:#ffffff;text-decoration:none;padding:17px 38px;border-radius:7px;font-size:15px;font-weight:bold;">Voir la recette sur Cookidoo →</a>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eeeeee;"></td></tr></table></td></tr>

        <!-- SIGN-OFF -->
        <tr>
          <td style="padding:0 40px 40px;">
            <p style="margin:0 0 4px;font-size:15px;color:#555555;line-height:1.7;">Je reste bien sûr à votre disposition si vous avez la moindre question.</p>
            <p style="margin:0 0 4px;font-size:15px;color:#555555;">Très belle journée à vous,</p>
            <p style="margin:0;font-size:15px;color:#555555;">À bientôt,<br><strong style="color:#1a1a1a;">Monique Pirson</strong></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
  }
];

export const groupColorMap: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-green-100 text-green-700 border-green-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200"
};
