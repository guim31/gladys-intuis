# Muller Intuitiv (intuis)

## Présentation

Cette intégration pilote depuis Gladys les **radiateurs connectés Muller Intuitiv** : ceux des
marques Muller, Campa, Airelec, Applimo ou Noirot équipés du module connecté et réglés avec l'appli
**intuis Connect** (anciennement « Muller Intuitiv with Netatmo »). Elle passe par le cloud intuis,
comme l'appli : Gladys voit ce que l'appli voit, et ce que vous changez dans Gladys apparaît dans
l'appli.

Pour chaque pièce : la température mesurée, la consigne, le mode (programme ou manuel), le mode de
chauffe (planning, absence, hors-gel), la chauffe en cours, la fenêtre ouverte, la présence et la
consommation électrique quand vos radiateurs la mesurent. Pour le logement : le mode de la maison
et le programme hebdomadaire actif.

Intégration indépendante, sans lien avec Muller, Groupe Atlantic ni intuis. **Développée sans le
matériel** : elle s'appuie sur l'API publiée par les projets de la communauté (Home Assistant,
Jeedom, Node-RED). Vos retours sont les bienvenus sur le forum de Gladys ou dans les tickets GitHub.

## Ce qu'il vous faut

- Gladys **5.2.0** ou plus récent.
- Des radiateurs déjà installés et réglés dans l'appli **intuis Connect**, avec leur passerelle
  connectée à Internet.
- L'adresse e-mail et le mot de passe de votre compte intuis Connect.

## Configuration

1. Dans Gladys, ouvrez **Intégrations**, installez **Muller Intuitiv (intuis)**, puis ouvrez son
   onglet **Configuration**.
2. Saisissez l'**e-mail** et le **mot de passe** de l'appli intuis Connect, puis enregistrez. L'état
   de la connexion s'affiche en haut de l'écran.
3. Le bouton **Tester la connexion** indique combien de logements et de pièces ont été trouvés.
4. Ouvrez l'onglet **Découverte** : chaque pièce et le logement y apparaissent. Ajoutez ceux qui
   vous intéressent.

Réglages facultatifs :

- **Durée d'une consigne réglée depuis Gladys** : combien de temps une température choisie dans
  Gladys est tenue avant que la pièce revienne à son programme, comme avec le « + » et le « - » de
  l'appli. Par défaut, la durée réglée dans l'appli intuis.
- **Suivre la consommation de chaque pièce** : activé par défaut.
- **Langue des noms de fonctionnalités** : le français par défaut. Les noms sont fixés à l'ajout de
  l'appareil : un changement ne vaut que pour les appareils ajoutés ensuite.

Le mot de passe reste dans Gladys et n'est envoyé qu'à intuis pour se connecter. L'intégration garde
dans son dossier `/data` les jetons de connexion qu'intuis lui remet, jamais le mot de passe.

## Les appareils

### Le logement

| Fonctionnalité        | Ce qu'elle fait                                                                 |
| --------------------- | ------------------------------------------------------------------------------- |
| **Mode de la maison** | Planning, Absence ou Hors-gel, pour tout le logement. Modifiable depuis Gladys. |
| **Programme actif**   | Le nom du programme hebdomadaire choisi dans l'appli (lecture seule).           |

### Chaque pièce

| Fonctionnalité          | Ce qu'elle fait                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Température**         | La température mesurée par les radiateurs de la pièce.                                                                                               |
| **Consigne**            | La température visée, de 7 à 30 °C au demi-degré. La changer depuis Gladys la tient pendant la durée choisie, puis la pièce revient à son programme. |
| **Programme ou manuel** | « Auto » quand la pièce suit son programme, « Chauffage » quand une consigne manuelle est tenue. Choisir « Auto » rend la pièce à son programme.     |
| **Mode de chauffe**     | Planning, Absence ou Hors-gel pour cette pièce seulement. Pendant une consigne manuelle, il montre ce qui reprendra ensuite.                         |
| **Chauffe**             | Si un radiateur de la pièce chauffe en ce moment. Seulement quand les radiateurs le disent (pas sur un fil pilote).                                  |
| **Fenêtre ouverte**     | La détection de fenêtre ouverte des radiateurs : « Ouvert » quand une baisse brutale de température a coupé la chauffe.                              |
| **Présence**            | Le détecteur de présence intégré, sur les radiateurs qui en ont un.                                                                                  |
| **Consommation**        | L'électricité consommée par la pièce, par demi-heure (ou par jour quand intuis ne donne que le total du jour), versée au suivi d'énergie de Gladys.  |

La **Chauffe**, la **Fenêtre ouverte**, la **Présence** et la **Consommation** n'apparaissent que si
vos radiateurs les fournissent. Si l'une d'elles apparaît plus tard (la consommation peut mettre une
journée à remonter), l'onglet Découverte propose **Mettre à jour** sur la pièce.

L'arrêt complet d'une pièce n'est pas proposé : un radiateur coupé par erreur en plein hiver peut
laisser geler une canalisation. Le **hors-gel** est l'arrêt sûr ; l'arrêt reste possible dans l'appli.

La consommation entre dans l'onglet **Énergie** de Gladys : rattachez les pièces à votre compteur et
à votre contrat (base, heures creuses…) pour en voir le coût. Le relevé à la demi-heure permet de
répartir heures pleines et heures creuses.

## Le widget

Ajoutez le widget **Pièces chauffées** à un tableau de bord. Il montre chaque pièce sur une ligne
(température mesurée → consigne, mode, fenêtre ouverte) et trois boutons pour le mode de la maison :
**Planning**, **Absence**, **Hors-gel**. Le mode en cours porte une coche. Avec plusieurs logements,
choisissez lequel dans les réglages du widget.

## Scènes

L'intégration ne déclare aucun déclencheur : une température, une fenêtre ouverte ou un mode sont
des états d'appareils, que l'éditeur de scènes sait déjà surveiller (« Quand un appareil change
d'état »).

Elle ajoute une action, dans la catégorie **Intégrations** de l'éditeur de scènes :

- **Régler la consigne d'une pièce pour un temps** : choisissez la pièce, la température (« 20,5 »,
  une variable de scène est acceptée) et la durée. Ensuite la pièce revient à son programme.
  L'action donne l'heure de retour au programme aux actions suivantes.

Les fonctionnalités des appareils se pilotent aussi par l'action habituelle « Contrôler un appareil »
: mode de la maison, consigne, mode de chauffe d'une pièce.

## Exemples de scènes

- **Départ de la maison** : quand le dernier occupant quitte la maison, mettre le **Mode de la
  maison** sur **Absence** ; à son retour, le remettre sur **Planning**.
- **Bain du soir** : chaque jour à 19 h, **Régler la consigne** de la salle de bain à 22,5 °C pendant
  1 heure.
- **Fenêtre oubliée** : quand la **Fenêtre ouverte** du salon passe à « Ouvert », envoyer un message ;
  les radiateurs coupent déjà la chauffe d'eux-mêmes.
- **Vacances** : avant de partir, passer le **Mode de la maison** sur **Hors-gel**.

## Rythme et quotas

- Les pièces et le logement sont relus **toutes les 5 minutes**, et quelques secondes après chaque
  commande. Une relecture coûte deux requêtes au cloud intuis.
- La consommation est lue **une fois par heure**, une requête par pièce ajoutée qui la fournit.
  intuis la complète avec du retard : comptez jusqu'à un jour pour la journée en cours.
- intuis ne publie pas de quota. Son API est celle de Netatmo, dont la limite documentée est de
  500 requêtes par heure et par compte : l'intégration en fait environ 30 pour un logement. Si intuis
  demande de ralentir, les lectures s'arrêtent 15 minutes.
- Après un mot de passe refusé, l'intégration attend 30 minutes avant de réessayer, pour ne jamais
  bloquer le compte. Enregistrer la configuration ou cliquer sur **Tester la connexion** réessaie
  aussitôt.

## En cas de problème

- **« intuis refuse l'e-mail ou le mot de passe »** : vérifiez-les en vous connectant à l'appli
  intuis Connect, puis enregistrez de nouveau la configuration.
- **« Le cloud intuis ne répond pas »** : le service intuis ou votre connexion Internet est
  indisponible. Les appareils passent « injoignables » et tout reprend seul au retour.
- **Une pièce est marquée hors ligne** : son radiateur ne parle plus à la passerelle (coupure de
  courant, module débranché). Vérifiez-la dans l'appli.
- **La consigne revient d'elle-même** : c'est la fin de la durée choisie, la pièce reprend son
  programme. Allongez la **Durée d'une consigne réglée depuis Gladys**.
- **Pas de consommation** : tous les radiateurs ne la mesurent pas (notamment ceux pilotés par fil
  pilote). L'intégration réessaie une fois par semaine.
- Pour plus de détails, ajoutez `LOG_LEVEL=debug` aux variables de l'intégration et consultez ses
  journaux : ils n'affichent jamais ni le mot de passe ni les jetons.

## Limites

- Développée **sans le matériel ni un compte intuis** : les échanges avec le cloud suivent les
  projets de la communauté et n'ont pas été éprouvés sur une installation réelle par l'auteur.
- Passe par le cloud : sans Internet ou si intuis change son API, plus rien ne remonte.
- Le programme hebdomadaire se modifie dans l'appli intuis, pas dans Gladys.
- Pas d'arrêt complet d'une pièce depuis Gladys (voir plus haut) ni de mode « boost ».
- La consommation arrive avec retard et n'est donnée que par certains radiateurs.
