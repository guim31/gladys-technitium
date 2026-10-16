# Technitium DNS

Suivez et pilotez votre [Technitium DNS Server](https://technitium.com/dns/)
depuis Gladys, sur votre réseau local : mettez son blocage en pause cinq
minutes depuis le tableau de bord quand un site ne s'affiche pas, voyez ses
requêtes de la dernière heure et du dernier jour, comptez ses baux DHCP, et
sachez quand il ne répond plus ou quand une mise à jour sort.

> **Testée contre un vrai Technitium DNS Server 15** (l'image Docker
> officielle), pas encore avec une vraie installation de Gladys : vos retours
> sont les bienvenus. Si quelque chose ne marche pas comme décrit, dites-le sur
> le [forum Gladys](https://community.gladysassistant.com) ou dans les
> [issues](https://github.com/guim31/gladys-technitium/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent (5.2.0 ou plus pour le bouton
  _Pause…_ du widget).
- **Technitium DNS Server** 15 ou plus récent, sa console web joignable depuis
  Gladys (port 5380 par défaut).
- Un **jeton d'API**. Dans la console web, ouvrez le menu de l'utilisateur (en
  haut à droite) → **Create API Token**, tapez votre mot de passe et un nom
  (par exemple `gladys`), puis copiez le jeton affiché. Le jeton n'expire pas ;
  supprimez-le dans **Administration** → **Sessions** pour le révoquer.

Le jeton agit au nom de son utilisateur. L'utilisateur `admin` peut tout faire.
Pour le limiter, créez un utilisateur dédié dans **Administration** →
**Users** et donnez à son groupe ces permissions : **Dashboard** (lecture),
**Settings** (lecture ; modification pour mettre le blocage en pause),
**Cache** (suppression, pour l'action de vidage du cache), **DHCP Server**
(lecture, facultatif : sans elle, pas de baux DHCP).

## Mise en route

1. Installez l'intégration depuis le catalogue de Gladys.
2. Dans **Configuration**, saisissez l'**Adresse** de votre serveur (par
   exemple `192.168.1.2` : le port 5380 est ajouté ; ou l'adresse complète de
   sa console web, comme `https://dns.example.net`), son **Jeton d'API**, et
   éventuellement un **Nom**. Deux ou trois serveurs ? Remplissez aussi les
   sections _Deuxième serveur_ et _Troisième serveur_.
3. Enregistrez, puis cliquez sur **Tester la connexion** : le message sous le
   bouton indique, pour chaque serveur, s'il répond, sa version et l'état de
   son blocage.
4. Ouvrez l'onglet **Découverte** : un appareil par serveur. Cliquez sur
   **Ajouter**, choisissez une pièce, enregistrez.

Options :

- **Accepter les certificats auto-signés** : pour une adresse en `https://`
  dont le serveur a signé lui-même le certificat. Laissez décoché pour les
  adresses en `http://`.
- **Intervalle de rafraîchissement** : fréquence de lecture des serveurs, de
  30 secondes à 5 minutes (1 minute par défaut).
- **Éteindre l'interrupteur de blocage** : ce que fait l'interrupteur de
  l'appareil quand vous l'éteignez : pause du blocage de 5 minutes (par
  défaut), 15, 30 ou 60 minutes, ou désactivation jusqu'à ce que vous le
  rallumiez.
- **Langue des noms de fonctionnalités** : anglais, français, allemand ou
  espagnol. Les noms sont donnés à l'ajout d'un appareil (français par défaut).

## L'appareil de chaque serveur

| Fonctionnalité                | Ce que c'est                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Blocage                       | Interrupteur : allumé, le serveur bloque les domaines listés ; éteint, tout passe |
| Requêtes DNS (dernière heure) | Requêtes reçues sur les 60 dernières minutes                                      |
| Requêtes DNS (24 h)           | Requêtes reçues sur le dernier jour                                               |
| Requêtes bloquées (24 h)      | Requêtes bloquées sur le dernier jour                                             |
| Part bloquée (24 h)           | Part des requêtes bloquées, en %, arrondie                                        |
| Clients (24 h)                | Appareils qui ont utilisé le serveur sur le dernier jour                          |
| Zones                         | Zones hébergées par le serveur (vos propres domaines)                             |
| Domaines bloqués              | Domaines des listes de blocage, plus ceux bloqués à la main                       |
| Mise à jour disponible        | 1 quand une version plus récente de Technitium est sortie, sinon 0                |
| Version                       | La version installée                                                              |
| Baux DHCP                     | Baux des étendues DHCP actives (seulement si le serveur DHCP est utilisé)         |

Le jour est celui du tableau de bord de Technitium (_Last Day_) : les 24 heures
pleines avant l'heure en cours, il a donc jusqu'à une heure de retard. Le
badge de l'appareil indique **Local** quand le serveur répond et
**Injoignable** sinon. Activer ou désactiver une étendue DHCP ajoute ou retire
la fonctionnalité _Baux DHCP_ : Gladys propose alors de **Mettre à jour**
l'appareil dans l'onglet Découverte.

## Tableau de bord

Ajoutez le widget **Technitium DNS** à un tableau de bord. Par défaut, il
montre tous vos serveurs ensemble ; choisissez-en un dans ses réglages pour
n'afficher que celui-là. Mettre en pause un seul serveur sur deux ne change
rien : vos appareils interrogent alors l'autre.

Le widget montre les requêtes, les requêtes bloquées et la part bloquée sur le
dernier jour, l'état de chaque serveur (blocage actif, en pause avec les
minutes restantes, désactivé, injoignable), les requêtes de la dernière heure,
les clients, les domaines bloqués, les baux DHCP et la mise à jour
disponible. Ses boutons :

- **Pause 5 min** et **Pause 30 min** : mettent le blocage en pause tout de
  suite ;
- **Pause…** : ouvre un petit formulaire pour taper la durée en minutes
  (Gladys 5.2.0 ou plus ; un Gladys plus ancien répond qu'il faut le mettre à
  jour) ;
- **Réactiver** : rallume le blocage. Il porte une coche quand le blocage est
  actif partout.

## Scènes

### Déclencheurs

- **Blocage Technitium mis en pause** : le blocage a été désactivé, depuis
  Gladys ou ailleurs (la console web, un autre outil). Filtrez par serveur et
  par origine (_Depuis Gladys_ ou _Hors de Gladys_). Les actions peuvent lire
  le nom du serveur et la durée de la pause en minutes (`duration_minutes`, 0
  quand elle est sans fin).
- **Blocage Technitium réactivé** : le blocage est de nouveau actif. L'origine
  dit si la pause s'est terminée d'elle-même (_Fin de la pause_), depuis
  Gladys ou ailleurs ; `paused_minutes` dit combien de temps elle a duré.
- **Mise à jour de Technitium disponible** : une nouvelle version de Technitium
  DNS Server est sortie. Annoncée une fois par version, même après un
  redémarrage. `version` est la nouvelle version, `current_version` celle
  installée.
- **Technitium ne répond plus** : un serveur n'a pas répondu à deux lectures de
  suite (la seconde 15 secondes après la première). Le DNS de la maison est
  peut-être en panne. `error` dit pourquoi, dans la langue de la configuration.
- **Technitium répond de nouveau** : il est de retour ; `down_minutes` dit au
  bout de combien de temps.

Un jeton refusé ne compte pas comme « ne répond plus » : l'écran Configuration
le signale.

### Actions

- **Mettre le blocage Technitium en pause** : met le blocage en pause sur un
  serveur, ou sur tous si le champ reste vide, pour un nombre de minutes (5 par
  défaut, 0 jusqu'à réactivation, un jour au plus). Les actions suivantes
  peuvent lire combien de serveurs ont été mis en pause.
- **Réactiver le blocage Technitium** : rallume le blocage, sur un serveur ou
  sur tous.
- **Vider le cache DNS de Technitium** : vide le cache DNS, par exemple après
  avoir modifié un enregistrement, pour que les requêtes suivantes soient
  résolues à neuf.
- **Lire les statistiques Technitium** : lit les requêtes du dernier jour en une
  phrase, comme « Sur les dernières 24 heures, 12 345 requêtes DNS, dont
  1 234 bloquées (10 %). Dernière heure : 456 requêtes. », dans la langue de
  la configuration. Les actions suivantes peuvent l'envoyer (`sentence`) ou
  utiliser les chiffres (`queries_last_day`, `blocked_last_day`,
  `blocked_percent`, `queries_last_hour`, `blocking_enabled`).

L'interrupteur _Blocage_ s'utilise aussi avec l'action standard de Gladys qui
contrôle un appareil.

### Idées de scènes

- **Bilan du matin** : chaque jour à 8 h, _Lire les statistiques Technitium_,
  puis envoyer la sortie `sentence` dans un message.
- **Alerte DNS** : _Technitium ne répond plus_ → envoyer un message
  « Technitium {{triggerEvent.data.server}} ne répond pas :
  {{triggerEvent.data.error}} ». Et _Technitium répond de nouveau_ → « de
  retour après {{triggerEvent.data.down_minutes}} min ».
- **Filet de sécurité** : une scène chaque soir à 20 h avec _Réactiver le
  blocage Technitium_, pour qu'un interrupteur éteint « jusqu'à réactivation »
  ne reste jamais éteint toute la nuit.

## Dépannage

- **« jeton d'API refusé »** : le jeton a été supprimé, ou mal recopié. Créez-en
  un nouveau et collez-le dans Gladys.
- **« accès refusé »** : il manque une permission à l'utilisateur du jeton
  (voir _Ce qu'il vous faut_). La lecture demande Dashboard et Settings
  (lecture) ; la pause demande Settings (modification).
- **« aucun serveur Technitium à cette adresse »** : autre chose répond à cette
  adresse. La console web écoute sur le port 5380 par défaut : saisissez
  `192.168.1.2`, ou `http://192.168.1.2:5380`.
- **« certificat refusé »** : vous avez saisi une adresse en `https://` ;
  cochez _Accepter les certificats auto-signés_, ou utilisez l'adresse en
  `http://`.
- **« l'adresse redirige »** : la console web renvoie les visiteurs HTTP vers
  le HTTPS ; saisissez l'adresse en `https://`.
- **« ne répond pas »** : vérifiez que la console web s'ouvre depuis un
  ordinateur du réseau de Gladys. Les noms en `.local` ne marchent en général
  pas dans l'intégration : utilisez l'adresse IP.
- Logs : sur la page de l'intégration dans Gladys, ou `docker logs` sur
  l'hôte. Ils montrent le démarrage, chaque serveur perdu puis retrouvé, les
  problèmes (une fois chacun, pas à chaque lecture) et vos commandes. Lancez
  le conteneur avec `LOG_LEVEL=debug` pour voir chaque lecture et chaque
  nouvel essai. Votre jeton n'apparaît jamais dans les logs.

## Limites

- Une intégration gère jusqu'à trois serveurs. Un cluster Technitium est vu
  serveur par serveur ; la pause s'applique au serveur visé (Technitium la
  propage aux autres nœuds du cluster).
- L'intégration lit chaque serveur une fois par intervalle de rafraîchissement
  (cinq petites requêtes) et lui demande de chercher une mise à jour toutes les
  six heures : aucun quota n'est en jeu.
- La part bloquée est arrondie dans l'appareil (Gladys n'a pas de capteur de
  pourcentage décimal) ; le widget affiche une décimale.
- Pas de détection de présence par les baux DHCP : Gladys a d'autres moyens
  pour cela.
- L'intégration ne gère ni les zones, ni les listes de blocage, ni les domaines
  autorisés ou bloqués, ni les étendues DHCP : utilisez la console web pour
  cela.

Cette intégration n'est pas affiliée à Technitium.
