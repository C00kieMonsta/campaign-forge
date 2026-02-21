export type Language = "fr" | "nl";

export const translations = {
  fr: {
    nav: { home: "Accueil", about: "À propos", contact: "Contact" },
    hero: {
      greeting: "Bonjour, je suis",
      name: "Monique Pirson",
      tagline: "Votre conseillère Thermomix de confiance",
      subtitle:
        "Découvrez l'art de cuisiner autrement avec le Thermomix. Je vous accompagne dans cette belle aventure culinaire.",
      cta: "Me contacter"
    },
    about: {
      title: "À propos de moi",
      description:
        "Passionnée de cuisine depuis toujours, j'ai découvert le Thermomix il y a plusieurs années. Cet appareil a transformé ma façon de cuisiner et je souhaite partager cette passion avec vous.",
      experience: "Années d'expérience",
      clients: "Clients satisfaits",
      recipes: "Recettes partagées"
    },
    thermomix: {
      title: "Pourquoi le Thermomix ?",
      subtitle: "Un appareil révolutionnaire qui simplifie votre quotidien",
      features: {
        versatile: {
          title: "Polyvalent",
          description: "Plus de 20 fonctions en un seul appareil"
        },
        quality: {
          title: "Qualité Premium",
          description: "Fabriqué en France avec les meilleurs matériaux"
        },
        easy: {
          title: "Facile à utiliser",
          description: "Des recettes guidées étape par étape"
        },
        healthy: {
          title: "Cuisine saine",
          description: "Préservez les nutriments de vos aliments"
        }
      }
    },
    contact: {
      title: "Contactez-moi",
      subtitle: "Envie d'en savoir plus ? N'hésitez pas à me contacter !",
      firstName: "Votre prénom",
      lastName: "Votre nom",
      email: "Votre email",
      subscribe: "S'inscrire à la newsletter",
      success: "Inscription réussie ! Merci.",
      alreadySubscribed: "Vous êtes déjà inscrit(e).",
      error: "Une erreur est survenue, veuillez réessayer."
    },
    footer: { rights: "Tous droits réservés" }
  },
  nl: {
    nav: { home: "Home", about: "Over mij", contact: "Contact" },
    hero: {
      greeting: "Hallo, ik ben",
      name: "Monique Pirson",
      tagline: "Uw betrouwbare Thermomix adviseur",
      subtitle:
        "Ontdek de kunst van anders koken met de Thermomix. Ik begeleid u in dit prachtige culinaire avontuur.",
      cta: "Contacteer mij"
    },
    about: {
      title: "Over mij",
      description:
        "Al mijn hele leven gepassioneerd door koken, ontdekte ik de Thermomix enkele jaren geleden. Dit apparaat heeft mijn manier van koken veranderd en ik wil deze passie graag met u delen.",
      experience: "Jaren ervaring",
      clients: "Tevreden klanten",
      recipes: "Gedeelde recepten"
    },
    thermomix: {
      title: "Waarom Thermomix?",
      subtitle:
        "Een revolutionair apparaat dat uw dagelijks leven vereenvoudigt",
      features: {
        versatile: {
          title: "Veelzijdig",
          description: "Meer dan 20 functies in één apparaat"
        },
        quality: {
          title: "Premium kwaliteit",
          description: "Gemaakt in Frankrijk met de beste materialen"
        },
        easy: {
          title: "Gemakkelijk te gebruiken",
          description: "Stapsgewijze begeleide recepten"
        },
        healthy: {
          title: "Gezond koken",
          description: "Behoud de voedingsstoffen van uw voedsel"
        }
      }
    },
    contact: {
      title: "Contacteer mij",
      subtitle:
        "Wilt u meer weten? Aarzel niet om contact met mij op te nemen!",
      firstName: "Uw voornaam",
      lastName: "Uw achternaam",
      email: "Uw email",
      subscribe: "Inschrijven voor de nieuwsbrief",
      success: "Inschrijving geslaagd! Bedankt.",
      alreadySubscribed: "U bent al ingeschreven.",
      error: "Er is een fout opgetreden, probeer het opnieuw."
    },
    footer: { rights: "Alle rechten voorbehouden" }
  }
};

export const getTranslation = (lang: Language) => translations[lang];
