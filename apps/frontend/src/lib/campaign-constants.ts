const IMAGE_PLACEHOLDER = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2YwZjBmMCIgcng9IjgiLz48dGV4dCB4PSIzMDAiIHk9IjEwOCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjIwIiBmaWxsPSIjYWFhYWFhIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5a877iPIFZvdHJlIGltYWdlIGljaTwvdGV4dD48L3N2Zz4=`;
const IMG_PLACEHOLDER_HTML = `<img src="${IMAGE_PLACEHOLDER}" alt="Votre image ici" style="width:100%;max-width:600px;display:block;margin:16px auto;border-radius:8px;cursor:pointer;" />`;

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
    html: `<p>Bonjour {{firstName}},</p><p>Votre message ici.</p><div style="text-align: center; margin: 20px 0;"><a href="mailto:monpirson@gmail.com" style="background-color: #558B2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Me contacter par email</a></div><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "promo" as const,
    html: `<h1 style="text-align: center"><span style="color: #c0603a">Titre de la promotion</span></h1><p>Bonjour {{firstName}},</p>${IMG_PLACEHOLDER_HTML}<p>Décrivez votre offre ici.</p><p style="text-align: center"><a href="#">Découvrir l'offre →</a></p><div style="text-align: center; margin: 20px 0;"><a href="mailto:monpirson@gmail.com" style="background-color: #558B2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Me contacter par email</a></div><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "newsletter" as const,
    html: `<h1>Titre de la newsletter</h1><p>Bonjour {{firstName}},</p><h2><span style="color: #c0603a">Actualité 1</span></h2><p>Contenu de votre première actualité...</p><hr><h2><span style="color: #c0603a">Actualité 2</span></h2><p>Contenu de votre deuxième actualité...</p><div style="text-align: center; margin: 20px 0;"><a href="mailto:monpirson@gmail.com" style="background-color: #558B2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Me contacter par email</a></div><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "thermomixMonthly" as const,
    html: `<h1 style="text-align: center"><span style="color: #E2001A">Action du mois Thermomix®</span></h1><p>Bonjour {{firstName}},</p><p>Ce mois-ci, nous avons une <strong>offre spéciale Thermomix®</strong> que vous ne voudrez pas manquer ! Profitez de cette opportunité unique pour découvrir de nouvelles recettes et accessoires.</p><h2><span style="color: #E2001A">🎯 L'action du mois</span></h2><p>Décrivez ici les détails de votre action mensuelle...</p>${IMG_PLACEHOLDER_HTML}<p style="text-align: center"><a href="#">Découvrir l'action →</a></p><hr><h2>🍳 La recette du mois</h2><p>Ajoutez ici une recette exclusive préparée avec le Thermomix®...</p>${IMG_PLACEHOLDER_HTML}<div style="text-align: center; margin: 20px 0;"><a href="mailto:monpirson@gmail.com" style="background-color: #558B2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Me contacter par email</a></div><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "thermomixChristmas" as const,
    html: `<h1 style="text-align: center"><span style="color: #8B0000">🎄 Joyeux Noël avec Thermomix® !</span></h1><p>Bonjour {{firstName}},</p><p>La période des fêtes approche, et quoi de mieux que de préparer de <strong>délicieux repas de Noël</strong> avec votre Thermomix® ? Laissez-vous inspirer par nos recettes festives spécialement sélectionnées pour vous.</p><h2><span style="color: #8B0000">🎁 Notre offre de Noël</span></h2><p>Détaillez ici votre offre ou promotion de Noël...</p>${IMG_PLACEHOLDER_HTML}<h2>🍽️ Nos recettes de fêtes</h2><ul><li>Bûche de Noël au chocolat</li><li>Velouté de châtaignes</li><li>Saumon en croûte</li></ul><p style="text-align: center"><a href="#">Découvrir les recettes de Noël →</a></p><div style="text-align: center; margin: 20px 0;"><a href="mailto:monpirson@gmail.com" style="background-color: #558B2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Me contacter par email</a></div><p>De tout cœur, Joyeux Noël ! 🎄<br>Monique Pirson</p>`,
  },
  {
    key: "thermomixEaster" as const,
    html: `<h1 style="text-align: center"><span style="color: #558B2F">🐣 Joyeuses Pâques avec Thermomix® !</span></h1><p>Bonjour {{firstName}},</p><p>Le printemps est là, et Pâques avec lui ! C'est le moment de cuisiner des <strong>recettes fraîches et colorées</strong> avec votre Thermomix®. Laissez-vous inspirer par nos idées festives pour cette belle saison.</p><h2><span style="color: #558B2F">🥚 Notre offre de Pâques</span></h2><p>Décrivez ici votre offre ou promotion de Pâques...</p>${IMG_PLACEHOLDER_HTML}<h2>🌸 Idées recettes pour Pâques</h2><ul><li>Agneau de Pâques et ses légumes de printemps</li><li>Charlotte aux fraises</li><li>Œufs en chocolat maison</li></ul><p style="text-align: center"><a href="#">Découvrir les recettes de Pâques →</a></p><div style="text-align: center; margin: 20px 0;"><a href="mailto:monpirson@gmail.com" style="background-color: #558B2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Me contacter par email</a></div><p>Joyeuses Pâques ! 🐣<br>Monique Pirson</p>`,
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
