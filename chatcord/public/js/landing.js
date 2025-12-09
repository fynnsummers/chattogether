        // Smooth scrolling für Anker-Links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });

        // Animation für Stats beim Scrollen
        const observerOptions = {
            threshold: 0.5,
            rootMargin: '0px 0px -100px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);

        // Stats-Items beobachten
        document.querySelectorAll('.stat-item').forEach(item => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(20px)';
            item.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(item);
        });

        // Feature-Cards Animation
        document.querySelectorAll('.feature-card').forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(30px)';
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            
            setTimeout(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, index * 200);
        });

        // Live Stats vom Server abrufen
        async function updateLiveStats() {
            const updateIndicator = document.getElementById('update-indicator');
            
            try {
                // Zeige Update-Status
                updateIndicator.classList.add('updating');
                updateIndicator.innerHTML = '<span class="pulse"></span>Aktualisiere...';
                
                const response = await fetch('/api/stats');
                const data = await response.json();
                
                if (data.success) {
                    const stats = data.data;
                    
                    // Online User
                    document.getElementById('online-users').textContent = stats.onlineUsers;
                    
                    // Aktive Gruppen
                    document.getElementById('active-rooms').textContent = stats.activeRooms;
                    
                    // Echte Nachrichten vom Server
                    document.getElementById('daily-messages').textContent = stats.dailyMessages.toLocaleString();
                    
                    // Uptime berechnen (Server läuft seit X Sekunden)
                    const uptimeHours = Math.floor(stats.uptime / 3600);
                    const uptimeMinutes = Math.floor((stats.uptime % 3600) / 60);
                    const uptimeString = `${uptimeHours}h ${uptimeMinutes}m`;
                    document.getElementById('uptime').textContent = uptimeString;
                    
                    // Update Online Users in Räumen
                    updateRoomUsers(stats.roomStats);
                    
                    // Zeige zusätzliche Informationen in der Konsole
                    console.log('Live Stats:', stats);
                    
                    // Update-Status zurücksetzen
                    setTimeout(() => {
                        updateIndicator.classList.remove('updating');
                        updateIndicator.innerHTML = '<span class="pulse"></span>Live';
                    }, 1000);
                }
            } catch (error) {
                console.error('Fehler beim Laden der Live-Statistiken:', error);
                // Fallback zu simulierten Daten
                const onlineUsers = Math.floor(Math.random() * 45) + 5;
                document.getElementById('online-users').textContent = onlineUsers;
                document.getElementById('active-rooms').textContent = '3';
                document.getElementById('daily-messages').textContent = (Math.floor(Math.random() * 900) + 100).toLocaleString();
                
                // Update-Status zurücksetzen
                setTimeout(() => {
                    updateIndicator.classList.remove('updating');
                    updateIndicator.innerHTML = '<span class="pulse"></span>Live';
                }, 1000);
            }
        }

        // Online User in Räumen anzeigen
        function updateRoomUsers(roomStats) {
            const roomUsersGrid = document.getElementById('room-users-grid');
            
            if (Object.keys(roomStats).length === 0) {
                roomUsersGrid.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-light); opacity: 0.7;">
                        <i class="fas fa-users" style="font-size: 3rem; margin-bottom: 15px; display: block;"></i>
                        <p>Derzeit sind keine User online</p>
                    </div>
                `;
                return;
            }
            
            roomUsersGrid.innerHTML = '';
            
            Object.entries(roomStats).forEach(([room, userCount]) => {
                const roomCard = document.createElement('div');
                roomCard.className = 'room-users-card';
                
                const roomDisplayName = room.replace('# ', '');
                const roomIcon = roomDisplayName === 'Global' ? 'fas fa-globe' : 
                               roomDisplayName === 'Deutsch' ? 'fas fa-flag' : 
                               roomDisplayName === 'English' ? 'fas fa-language' : 'fas fa-hashtag';
                
                roomCard.innerHTML = `
                    <div class="room-users-header">
                        <div class="room-name-header">
                            <i class="${roomIcon}"></i> ${roomDisplayName}
                        </div>
                        <div class="room-user-count">${userCount}</div>
                    </div>
                    <div class="room-users-list">
                        <div class="room-user-item">
                            ${userCount} User online
                        </div>
                    </div>
                `;
                
                roomUsersGrid.appendChild(roomCard);
            });
        }

        // Update Stats alle 5 Sekunden
        updateLiveStats();
        setInterval(updateLiveStats, 5000);

        // Zusätzliche Informationen
        const additionalInfo = {
            features: [
                'Emoji-Unterstützung',
                'Nachrichtenbearbeitung',
                'Benutzerprofile',
                'Moderations-Tools',
                'Sound-Benachrichtigungen',
                'Mobile Optimierung'
            ],
            rooms: [
                { name: 'Global', description: 'Weltweite Diskussionen' },
                { name: 'Deutsch', description: 'Deutschsprachige Community' },
                { name: 'English', description: 'Internationale Gespräche' }
            ]
        };

        // Zeige zusätzliche Features in der Konsole (für Entwickler)
        console.log('Chat Together Features:', additionalInfo);