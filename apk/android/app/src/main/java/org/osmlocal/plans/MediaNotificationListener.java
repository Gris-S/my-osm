package org.osmlocal.plans;

import android.service.notification.NotificationListenerService;

/**
 * Service vide, et c'est voulu : il ne lit **aucune** notification.
 *
 * Android réserve la liste des lecteurs en cours (`MediaSessionManager
 * .getActiveSessions`) aux applications dont un tel service a reçu « l'accès aux
 * notifications ». Sa seule présence, une fois autorisée par l'utilisateur, est
 * ce qui permet à `NowPlayingPlugin` de voir et contrôler la musique.
 */
public class MediaNotificationListener extends NotificationListenerService {}
