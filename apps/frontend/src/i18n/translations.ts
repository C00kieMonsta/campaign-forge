export type Language = "fr" | "nl";

export const translations = {
  fr: {
    nav: { home: "Accueil" },
    login: { title: "Connexion Administration", email: "Email", password: "Mot de passe", submit: "Se connecter", error: "Email ou mot de passe incorrect" },
    dashboard: { title: "Tableau de bord", contacts: "Contacts", campaigns: "Campagnes", totalContacts: "Total contacts", withEmail: "Avec email", recentlyAdded: "Ajoutés récemment" },
    contacts: { title: "Gestion des contacts", addNew: "Ajouter un contact", search: "Rechercher...", name: "Nom", email: "Email", phone: "Téléphone", status: "Statut", actions: "Actions", noContacts: "Aucun contact trouvé" },
    contactForm: { title: "Nouveau contact", editTitle: "Modifier le contact", firstName: "Prénom", lastName: "Nom", email: "Email", phone: "Téléphone", notes: "Notes personnelles", save: "Enregistrer", cancel: "Annuler" },
    campaigns: { title: "Campagnes", create: "Nouvelle campagne", name: "Nom", subject: "Objet", status: "Statut", sentAt: "Envoyé le", actions: "Actions", noCampaigns: "Aucune campagne" },
    campaignForm: { title: "Nouvelle campagne", editTitle: "Modifier la campagne", name: "Nom", subject: "Objet", htmlBody: "Contenu HTML", save: "Enregistrer", cancel: "Annuler" },
    logout: "Déconnexion",
  },
  nl: {
    nav: { home: "Home" },
    login: { title: "Administratie Login", email: "Email", password: "Wachtwoord", submit: "Inloggen", error: "Onjuiste email of wachtwoord" },
    dashboard: { title: "Dashboard", contacts: "Contacten", campaigns: "Campagnes", totalContacts: "Totaal contacten", withEmail: "Met email", recentlyAdded: "Recent toegevoegd" },
    contacts: { title: "Contactbeheer", addNew: "Contact toevoegen", search: "Zoeken...", name: "Naam", email: "Email", phone: "Telefoon", status: "Status", actions: "Acties", noContacts: "Geen contacten gevonden" },
    contactForm: { title: "Nieuw contact", editTitle: "Contact bewerken", firstName: "Voornaam", lastName: "Achternaam", email: "Email", phone: "Telefoon", notes: "Persoonlijke notities", save: "Opslaan", cancel: "Annuleren" },
    campaigns: { title: "Campagnes", create: "Nieuwe campagne", name: "Naam", subject: "Onderwerp", status: "Status", sentAt: "Verzonden op", actions: "Acties", noCampaigns: "Geen campagnes" },
    campaignForm: { title: "Nieuwe campagne", editTitle: "Campagne bewerken", name: "Naam", subject: "Onderwerp", htmlBody: "HTML inhoud", save: "Opslaan", cancel: "Annuleren" },
    logout: "Uitloggen",
  },
};

export const getTranslation = (lang: Language) => translations[lang];
