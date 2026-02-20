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
    html: `<p>Bonjour {{firstName}},</p><p>Votre message ici.</p><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "promo" as const,
    html: `<h1 style="text-align: center"><span style="color: #c0603a">Titre de la promotion</span></h1><p>Bonjour {{firstName}},</p><p>Décrivez votre offre ici.</p><p style="text-align: center"><a href="#">Découvrir l'offre →</a></p><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "newsletter" as const,
    html: `<h1>Titre de la newsletter</h1><p>Bonjour {{firstName}},</p><h2><span style="color: #c0603a">Actualité 1</span></h2><p>Contenu de votre première actualité...</p><hr><h2><span style="color: #c0603a">Actualité 2</span></h2><p>Contenu de votre deuxième actualité...</p><p>Cordialement,<br>Monique Pirson</p>`,
  },
  {
    key: "thermomixMonthly" as const,
    html: `<h1 style="text-align: center"><span style="color: #E2001A">Action du mois Thermomix®</span></h1><p>Bonjour {{firstName}},</p><p>Ce mois-ci, nous avons une <strong>offre spéciale Thermomix®</strong> que vous ne voudrez pas manquer ! Profitez de cette opportunité unique pour découvrir de nouvelles recettes et accessoires.</p><h2><span style="color: #E2001A">🎯 L'action du mois</span></h2><p>Décrivez ici les détails de votre action mensuelle...</p><p style="text-align: center"><a href="#">Découvrir l'action →</a></p><hr><h2>🍳 La recette du mois</h2><p>Ajoutez ici une recette exclusive préparée avec le Thermomix®...</p><p>Cordialement,<br>L'équipe Thermomix® Belgium</p>`,
  },
  {
    key: "thermomixChristmas" as const,
    html: `<h1 style="text-align: center"><span style="color: #8B0000">🎄 Joyeux Noël avec Thermomix® !</span></h1><p>Bonjour {{firstName}},</p><p>La période des fêtes approche, et quoi de mieux que de préparer de <strong>délicieux repas de Noël</strong> avec votre Thermomix® ? Laissez-vous inspirer par nos recettes festives spécialement sélectionnées pour vous.</p><h2><span style="color: #8B0000">🎁 Notre offre de Noël</span></h2><p>Détaillez ici votre offre ou promotion de Noël...</p><h2>🍽️ Nos recettes de fêtes</h2><ul><li>Bûche de Noël au chocolat</li><li>Velouté de châtaignes</li><li>Saumon en croûte</li></ul><p style="text-align: center"><a href="#">Découvrir les recettes de Noël →</a></p><p>De tout cœur, Joyeux Noël ! 🎄<br>L'équipe Thermomix® Belgium</p>`,
  },
  {
    key: "thermomixEaster" as const,
    html: `<h1 style="text-align: center"><span style="color: #558B2F">🐣 Joyeuses Pâques avec Thermomix® !</span></h1><p>Bonjour {{firstName}},</p><p>Le printemps est là, et Pâques avec lui ! C'est le moment de cuisiner des <strong>recettes fraîches et colorées</strong> avec votre Thermomix®. Laissez-vous inspirer par nos idées festives pour cette belle saison.</p><h2><span style="color: #558B2F">🥚 Notre offre de Pâques</span></h2><p>Décrivez ici votre offre ou promotion de Pâques...</p><h2>🌸 Idées recettes pour Pâques</h2><ul><li>Agneau de Pâques et ses légumes de printemps</li><li>Charlotte aux fraises</li><li>Œufs en chocolat maison</li></ul><p style="text-align: center"><a href="#">Découvrir les recettes de Pâques →</a></p><p>Joyeuses Pâques ! 🐣<br>L'équipe Thermomix® Belgium</p>`,
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
