/* Scripts d'origine de characters.html (lightbox, dégradés, lazy-load).
   Seules 2 lignes du lightbox ont été adaptées pour les fiches ajoutées par le pop-up. */

document.addEventListener("DOMContentLoaded", () => {
    
    /* --- CARROUSEL LIGHTBOX (Version sécurisée) --- */

    // --- 1. Sélection des éléments DOM ---
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const closeBtn = document.getElementById("lightbox-close");
    const prevBtn = document.getElementById("lightbox-prev"); // Sera 'null' si non trouvé
    const nextBtn = document.getElementById("lightbox-next"); // Sera 'null' si non trouvé

    // --- 2. Variables du carrousel ---
    let galleryImages = []; 
    let currentIndex = 0;

    // --- 3. SÉLECTEUR D'IMAGES (Adapté à votre script) ---
    // On utilise le sélecteur de votre nouveau script
    const imageSelectors = ".mood img";

    // --- 4. Fonction pour trouver et lier les images ---
    function setupImageGallery() {
        // On cherche toutes les images qui correspondent au sélecteur
        const allImages = document.querySelectorAll(imageSelectors);
        galleryImages = Array.from(allImages); // On les stocke dans notre liste

        // On ajoute les écouteurs sur chaque image
        galleryImages.forEach((img, index) => {
            img.style.cursor = "pointer"; 
            
            // On vérifie si l'image a déjà été traitée (pour le setInterval)
            if (!img.dataset.galleryIndex) { 
                img.dataset.galleryIndex = index; // On marque l'image
                
                img.addEventListener("click", (e) => {
                    e.preventDefault(); // Empêche le comportement par défaut
                    showImage(galleryImages.indexOf(img));   // Ouvre le carrousel à l'image cliquée (index recalculé)
                });
            }
        });
    }
    
    // --- 5. Fonctions du carrousel ---
    
    // Affiche une image spécifique par son index
    function showImage(index) {
        if (index < 0 || index >= galleryImages.length) return;
        
        // Sécurité : s'assure que la lightbox existe
        if (!lightbox || !lightboxImg) return; 
        
        currentIndex = index;
        lightboxImg.src = galleryImages[index].src; 
        lightbox.style.display = "flex";
    }
    
    // Affiche l'image suivante
    function showNext() {
        let nextIndex = currentIndex + 1;
        if (nextIndex >= galleryImages.length) nextIndex = 0; // Boucle
        showImage(nextIndex);
    }
    
    // Affiche l'image précédente
    function showPrev() {
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = galleryImages.length - 1; // Boucle
        showImage(prevIndex);
    }
    
    // Ferme la lightbox
    function closeLightbox() {
        if (lightbox) {
            lightbox.style.display = "none";
            lightboxImg.src = "";
        }
    }

    // --- 6. Ajout des écouteurs d'événements (SÉCURISÉ) ---
    
    // On vérifie si les flèches existent avant d'ajouter un listener
    // C'est la partie "anti-crash"
    if (prevBtn) {
        prevBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Empêche de fermer la lightbox
            showPrev();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showNext();
        });
    }

    // Sécurité aussi pour les éléments de base
    if (closeBtn) {
        closeBtn.addEventListener("click", closeLightbox);
    }

    if (lightbox) {
        lightbox.addEventListener("click", (e) => {
            if (e.target === lightbox) { // Si on clique sur le fond
                closeLightbox();
            }
        });
    }
    
    // Gestion du clavier
    document.addEventListener("keydown", (e) => {
        // N'agit que si la lightbox IMAGE est ouverte
        if (lightbox && lightbox.style.display === "flex") {
            if (e.key === "Escape") closeLightbox();
            if (e.key === "ArrowLeft") showPrev();
            if (e.key === "ArrowRight") showNext();
        }
    });
    
    // --- 7. Lancement ---
    window.setupImageGallery = setupImageGallery; // utilisé par ajout-fiche.js
    setupImageGallery();
    
    // Relance la détection pour s'adapter à ForumActif (chargement dynamique)
    let count = 0;
    const interval = setInterval(() => {
        setupImageGallery(); 
        count++;
        if (count > 20) clearInterval(interval); // Arrête après 10s
    }, 500);

});

function applyGradientOpacity(opacity = 0.5) {
  const root = getComputedStyle(document.documentElement);

  document.querySelectorAll(".container").forEach(el => {
    const id = el.id;             // ex: "abell"
    const gradient = root.getPropertyValue(`--${id}`).trim();

    if (gradient) {
      el.style.backgroundImage =
        `linear-gradient(rgba(0,0,0,${1 - opacity}), rgba(0,0,0,${1 - opacity})), ${gradient}`;
      el.style.backgroundBlendMode = "color";
    }
  });
}

// Lance la fonction une fois que le DOM est prêt
document.addEventListener("DOMContentLoaded", () => {
  applyGradientOpacity(0.15); // change la valeur ici
});

(function () {
  const scrollRoot = document.querySelector('.scroll-wrapper'); // ⚠️ À ADAPTER
  if (!scrollRoot) return;

  const containers = Array.from(scrollRoot.querySelectorAll('.container'));
  if (!containers.length) return;

  // 1️⃣ Convertit toutes les images en lazy (src → data-src)
  containers.forEach(container => {
    container.querySelectorAll('img').forEach(img => {
      if (!img.dataset.src && img.src) {
        img.dataset.src = img.src;
        img.removeAttribute('src');
      }
    });
  });

  // 2️⃣ Utils
  function loadImages(container) {
    if (!container) return;
    container.querySelectorAll('img[data-src]').forEach(img => {
      if (!img.src) img.src = img.dataset.src;
    });
  }

  function unloadImages(container) {
    if (!container) return;
    container.querySelectorAll('img').forEach(img => {
      if (img.dataset.src) {
        img.removeAttribute('src');
        img.src = '';
      }
    });
  }

  // 3️⃣ Observer horizontal + snap
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        const index = containers.indexOf(entry.target);

        // Charge uniquement : précédent / courant / suivant
        loadImages(containers[index - 1]);
        loadImages(containers[index]);
        loadImages(containers[index + 1]);

        // Décharge tout le reste
        containers.forEach((c, i) => {
          if (Math.abs(i - index) > 1) {
            unloadImages(c);
          }
        });
      });
    },
    {
      root: scrollRoot,
      threshold: 0.6
    }
  );

  // 4️⃣ Active l’observer
  containers.forEach(container => observer.observe(container));
})();
