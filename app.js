let tracks = [];
let currentTrackIndex = -1;
let playlists = JSON.parse(localStorage.getItem('playlists')) || {};
let db;

const audio = document.getElementById('audio-player');
const btnPlay = document.getElementById('btn-play');
const trackList = document.getElementById('track-list');

// Инициализация при старте приложения
initDB().then(() => {
    loadSavedDirectory(); 
    renderPlaylists();
});

// КОРРЕКТНАЯ НАВИГАЦИЯ (Работает на HTTPS и в PWA без ошибок)
function changeScreen(screenId, e) {
    // Прячем экраны
    document.querySelectorAll('.app-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    // Убираем подсветку кнопок
    document.querySelectorAll('.nav-item').forEach(button => {
        button.classList.remove('active');
    });
    
    // Включаем нужный экран
    const targetScreen = document.getElementById(`screen-${screenId}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
    
    // Безопасное подсвечивание кнопки меню (без использования глобального event)
    if (e && e.currentTarget) {
        e.currentTarget.classList.add('active');
    } else if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('active');
    }
}

// БАЗА ДАННЫХ ДЛЯ СОХРАНЕНИЯ ДОСТУПА К ПАПКЕ
function initDB() {
    return new Promise((resolve) => {
        let request = indexedDB.open("musiCallDB", 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            db.createObjectStore("settings");
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };
        request.onerror = () => resolve(); // Защита от блокировки БД
    });
}

// Авто-загрузка папки
async function loadSavedDirectory() {
    if (!db) return;
    try {
        let tx = db.transaction("settings", "readonly");
        let store = tx.objectStore("settings");
        let request = store.get("dirHandle");

        request.onsuccess = async () => {
            const dirHandle = request.result;
            if (dirHandle) {
                // Если это PWA на Android, то при старте Chrome спросит разрешение
                if (await dirHandle.queryPermission({ mode: 'read' }) === 'granted' || 
                    await dirHandle.requestPermission({ mode: 'read' }) === 'granted') {
                    
                    document.getElementById('dir-path-display').value = dirHandle.name;
                    await readDirectory(dirHandle);
                }
            }
        };
    } catch(e) {
        console.log("IndexedDB не поддерживается или заблокирован в данном режиме.");
    }
}

// Сканирование папки
async function readDirectory(dirHandle) {
    tracks = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
            const file = await entry.getFile();
            tracks.push({
                name: file.name.replace(/\.[^/.]+$/, ""), 
                url: URL.createObjectURL(file) 
            });
        }
    }
    renderTracks();
}

// Кнопка выбора папки
const btnSelectDir = document.getElementById('btn-select-dir');
if (btnSelectDir) {
    btnSelectDir.addEventListener('click', async () => {
        // Проверка: поддерживает ли браузер/режим эту функцию
        if (!window.showDirectoryPicker) {
            alert('Ваш браузер заблокировал доступ к папкам по HTTPS. Пожалуйста, зайдите в меню Chrome (3 точки) и выберите "Добавить на главный экран" / "Установить приложение", после чего запустите плеер с иконки на экране телефона.');
            return;
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            
            if (db) {
                let tx = db.transaction("settings", "readwrite");
                tx.objectStore("settings").put(dirHandle, "dirHandle");
            }

            document.getElementById('dir-path-display').value = dirHandle.name;
            await readDirectory(dirHandle);
            alert(`Успешно! Найдено треков: ${tracks.length}`);
        } catch (err) {
            alert('Вы отменили выбор папки или браузер отклонил запрос.');
        }
    });
}

function renderTracks() {
    trackList.innerHTML = '';
    if (tracks.length === 0) {
        trackList.innerHTML = '<li class="empty-msg">Тут пока пусто. Нажмите "Изменить" в Настройках.</li>';
        return;
    }
    tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = `track-item ${index === currentTrackIndex ? 'current' : ''}`;
        li.innerHTML = `
            <span onclick="playTrack(${index})">${track.name}</span>
            <div class="track-actions">
                <button onclick="addTrackToPlaylist(${index})"><i class="fas fa-plus"></i></button>
                <button onclick="deleteTrack(${index})"><i class="fas fa-trash"></i></button>
            </div>
        `;
        trackList.appendChild(li);
    });
}

function playTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    currentTrackIndex = index;
    audio.src = tracks[index].url;
    document.getElementById('track-title').textContent = tracks[index].name;

    // Шторка Android (Media Session)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: tracks[index].name,
            artist: 'musiCall Pro',
            album: 'Локальная папка',
            artwork: [{ src: 'img.jpg', sizes: '512x512', type: 'image/jpeg' }]
        });
        navigator.mediaSession.setActionHandler('play', () => audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => playTrack(currentTrackIndex - 1));
        navigator.mediaSession.setActionHandler('nexttrack', () => playTrack(currentTrackIndex + 1));
    }

    audio.play();
    renderTracks();
}

// Громкость (100 уровней)
document.getElementById('volume-control').addEventListener('input', (e) => {
    let vol = e.target.value;
    audio.volume = vol / 100;
    document.getElementById('volume-value').textContent = `${vol}%`;
});

// ПЛЕЙЛИСТЫ
function createNewPlaylist() {
    const name = document.getElementById('new-playlist-name').value.trim();
    if (!name) return;
    if (!playlists[name]) playlists[name] = [];
    localStorage.setItem('playlists', JSON.stringify(playlists));
    document.getElementById('new-playlist-name').value = '';
    renderPlaylists();
}

function renderPlaylists() {
    const container = document.getElementById('playlist-list');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(playlists).forEach(name => {
        const li = document.createElement('li');
        li.className = 'track-item';
        li.innerHTML = `
            <span onclick="playPlaylist('${name}')"><i class="fas fa-compact-disc"></i> ${name} (${playlists[name].length} шт.)</span>
            <button onclick="deletePlaylist('${name}')" style="background:none; border:none; color:#ff4444;"><i class="fas fa-trash"></i></button>
        `;
        container.appendChild(li);
    });
}

function addTrackToPlaylist(index) {
    const pNames = Object.keys(playlists);
    if (pNames.length === 0) return alert("Сначала создайте плейлист во вкладке Настройки!");
    
    let target = prompt(`В какой плейлист добавить?\nДоступные: ${pNames.join(', ')}`);
    if (target && playlists[target]) {
        let trackName = tracks[index].name;
        if (!playlists[target].includes(trackName)) {
            playlists[target].push(trackName);
            localStorage.setItem('playlists', JSON.stringify(playlists));
            renderPlaylists();
        }
    }
}

function playPlaylist(name) {
    let playlistTrackNames = playlists[name];
    let playlistTracks = tracks.filter(t => playlistTrackNames.includes(t.name));
    
    if (playlistTracks.length === 0) {
        alert("В плейлисте нет треков, доступных в текущей папке.");
        return;
    }
    
    tracks = playlistTracks;
    renderTracks();
    changeScreen('player'); 
    playTrack(0);
}

function deletePlaylist(name) {
    delete playlists[name];
    localStorage.setItem('playlists', JSON.stringify(playlists));
    renderPlaylists();
}

function deleteTrack(index) {
    if (confirm(`Убрать ${tracks[index].name} из списка?`)) {
        tracks.splice(index, 1);
        renderTracks();
    }
}

audio.addEventListener('ended', () => {
    playTrack(currentTrackIndex + 1);
});
