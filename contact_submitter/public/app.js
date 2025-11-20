const API_BASE = 'http://localhost:3000/api';

let currentPage = 1;
const logsPerPage = 50;
let uploadedUrls = [];
let uploadedFilePath = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadProfiles();
    loadLogs();
    setupEventListeners();
});

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });

    // Profile modal
    document.getElementById('newProfileBtn').addEventListener('click', openProfileModal);
    document.getElementById('closeModal').addEventListener('click', closeProfileModal);
    document.getElementById('cancelBtn').addEventListener('click', closeProfileModal);
    document.getElementById('profileForm').addEventListener('submit', handleProfileSubmit);

    // Logs pagination
    document.getElementById('refreshLogsBtn').addEventListener('click', () => loadLogs());
    document.getElementById('exportCsvBtn').addEventListener('click', exportLogsAsCsv);
    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadLogs();
        }
    });
    document.getElementById('nextPage').addEventListener('click', () => {
        currentPage++;
        loadLogs();
    });

    // File upload and submit
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('profileSelect').addEventListener('change', updateSubmitButton);
    document.getElementById('submitJobBtn').addEventListener('click', handleJobSubmit);
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData,
        });

        const result = await res.json();

        uploadedFilePath = result["filePath"];

        uploadedUrls = result["urls"].map(line => {
            const parts = line.split(',');
            return parts[0].trim();
        }).filter(url => url.length > 0);

        const previewBox = document.getElementById('urlPreviewBox');
        previewBox.innerHTML = uploadedUrls.slice(0, 10).map(url =>
            `<div>${escapeHtml(url)}</div>`
        ).join('');

        document.getElementById('urlCount').textContent =
            `合計 ${uploadedUrls.length} 件のURLが読み込まれました`;
        document.getElementById('urlPreview').style.display = 'block';

        updateSubmitButton();
    } catch (e) {
        console.error(e);
        if (statusDiv) {
            statusDiv.querySelector('p').textContent = `❌ アップロードエラー: ${e.message}`;
        }
    }
}

function updateSubmitButton() {
    const profileId = document.getElementById('profileSelect').value;
    const hasUrls = uploadedUrls.length > 0;
    document.getElementById('submitJobBtn').disabled = !(profileId && hasUrls);
}

async function handleJobSubmit() {
    const profileId = parseInt(document.getElementById('profileSelect').value);

    if (!profileId || uploadedUrls.length === 0) {
        alert('プロファイルとファイルを選択してください');
        return;
    }

    const statusDiv = document.getElementById('jobStatus');
    statusDiv.style.display = 'block';
    statusDiv.querySelector('p').innerHTML = '送信ジョブを開始しています...';

    try {
        const res = await fetch(`${API_BASE}/submit-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filePath: uploadedFilePath,
                profileId: profileId
            })
        });

        const result = await res.json();

        if (res.ok) {
            const jobId = result.jobId;
            statusDiv.querySelector('p').innerHTML = `
                ✅ ${result.message}<br>
                <strong>ジョブID:</strong> ${jobId}<br>
                <strong>プロファイル:</strong> ${result.profileName}<br>
                <div id="jobProgress" style="margin-top: 10px;">
                    <div style="color: var(--text-secondary);">進行状況を監視中...</div>
                </div>
            `;

            // Poll job status
            pollJobStatus(jobId);

            // Reset form
            document.getElementById('fileInput').value = '';
            document.getElementById('urlPreview').style.display = 'none';
            uploadedUrls = [];
            updateSubmitButton();
        } else {
            statusDiv.querySelector('p').textContent = `❌ エラー: ${result.error}`;
        }
    } catch (e) {
        statusDiv.querySelector('p').textContent = `❌ エラー: ${e.message}`;
    }
}

async function pollJobStatus(jobId) {
    const progressDiv = document.getElementById('jobProgress');
    if (!progressDiv) return;

    const pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/jobs/${jobId}`);
            if (!res.ok) {
                clearInterval(pollInterval);
                return;
            }

            const job = await res.json();

            // Update progress display
            const progress = job.totalUrls > 0 ? Math.round((job.processedUrls / job.totalUrls) * 100) : 0;
            progressDiv.innerHTML = `
                <div style="margin-bottom: 8px;">
                    <strong>ステータス:</strong> ${job.status === 'running' ? '🔄 実行中' : job.status === 'completed' ? '✅ 完了' : '❌ 失敗'}
                </div>
                <div style="margin-bottom: 8px;">
                    <strong>進捗:</strong> ${job.processedUrls} / ${job.totalUrls} (${progress}%)
                </div>
                <div style="margin-bottom: 8px;">
                    <strong>成功:</strong> <span style="color: var(--success);">${job.successCount}</span> | 
                    <strong>失敗:</strong> <span style="color: var(--fail);">${job.failCount}</span>
                </div>
                ${job.currentUrl ? `<div style="margin-bottom: 8px;"><strong>処理中:</strong> ${escapeHtml(job.currentUrl)}</div>` : ''}
                <div style="margin-top: 10px;">
                    <strong>ログ:</strong>
                    <div style="background: var(--bg-tertiary); padding: 8px; border-radius: 4px; max-height: 200px; overflow-y: auto; font-size: 0.85rem; margin-top: 4px;">
                        ${job.logs.slice(-10).map(log => `<div>${escapeHtml(log)}</div>`).join('')}
                    </div>
                </div>
            `;

            // Stop polling if job is completed or failed
            if (job.status === 'completed' || job.status === 'failed') {
                clearInterval(pollInterval);
                loadStats(); // Refresh stats

                // Auto-switch to logs tab after 3 seconds
                setTimeout(() => {
                    switchTab('logs');
                }, 3000);
            }
        } catch (e) {
            console.error('Failed to poll job status:', e);
            clearInterval(pollInterval);
        }
    }, 2000); // Poll every 2 seconds
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(tab).classList.add('active');

    if (tab === 'logs') {
        loadLogs();
    } else if (tab === 'submit') {
        populateProfileSelector();
    }
}

async function populateProfileSelector() {
    try {
        const res = await fetch(`${API_BASE}/profiles`);
        const profiles = await res.json();

        const select = document.getElementById('profileSelect');
        select.innerHTML = '<option value="">プロファイルを選択してください</option>';

        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            select.appendChild(option);
        });
    } catch (e) {
        console.error('Failed to load profiles for selector:', e);
    }
}

async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        const stats = await res.json();

        document.getElementById('statTotal').textContent = stats.total;
        document.getElementById('statSuccess').textContent = stats.success;
        document.getElementById('statFail').textContent = stats.fail;
        document.getElementById('statPending').textContent = stats.pending;
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

async function loadProfiles() {
    try {
        const res = await fetch(`${API_BASE}/profiles`);
        const profiles = await res.json();

        const grid = document.getElementById('profilesGrid');
        grid.innerHTML = '';

        if (profiles.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">プロファイルがありません。新規作成してください。</p>';
            return;
        }

        profiles.forEach(profile => {
            const card = document.createElement('div');
            card.className = 'profile-card';
            card.innerHTML = `
                <h3>${escapeHtml(profile.name)}</h3>
                <div class="profile-data">${escapeHtml(JSON.stringify(profile.data, null, 2))}</div>
                <div class="profile-actions">
                    <button class="btn btn-secondary edit-profile-btn" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}">編集</button>
                    <button class="btn btn-danger" onclick="deleteProfile(${profile.id})">削除</button>
                </div>
            `;

            // Store profile data on the card element
            card.dataset.profileData = JSON.stringify(profile.data);

            // Add event listener for edit button
            const editBtn = card.querySelector('.edit-profile-btn');
            editBtn.addEventListener('click', () => {
                editProfile(profile.id, profile.name, profile.data);
            });

            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load profiles:', e);
    }
}

async function loadLogs() {
    try {
        const offset = (currentPage - 1) * logsPerPage;
        const res = await fetch(`${API_BASE}/logs?limit=${logsPerPage}&offset=${offset}`);
        const logs = await res.json();

        const tbody = document.getElementById('logsTableBody');
        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">ログがありません</td></tr>';
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');
            const statusClass = log.result === 'success' ? 'success' : log.result === 'fail' ? 'fail' : 'pending';
            tr.innerHTML = `
                <td>${log.id}</td>
                <td>${new Date(log.sent_time).toLocaleString('ja-JP')}</td>
                <td>${escapeHtml(log.root_url)}</td>
                <td><a href="${escapeHtml(log.sent_url)}" target="_blank" style="color: var(--accent);">${escapeHtml(log.sent_url)}</a></td>
                <td><span class="status-badge ${statusClass}">${escapeHtml(log.result)}</span></td>
                <td>${escapeHtml(log.profile_name)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('pageInfo').textContent = `Page ${currentPage}`;
        loadStats(); // Refresh stats
    } catch (e) {
        console.error('Failed to load logs:', e);
    }
}

function openProfileModal() {
    document.getElementById('modalTitle').textContent = '新規プロファイル';
    document.getElementById('profileForm').reset();
    delete document.getElementById('profileForm').dataset.editingId; // Clear editing ID
    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
    delete document.getElementById('profileForm').dataset.editingId; // Clear editing ID on close
}

async function handleProfileSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('profileName').value;
    const dataStr = document.getElementById('profileData').value;
    const editingId = document.getElementById('profileForm').dataset.editingId;

    try {
        const data = JSON.parse(dataStr);

        const res = await fetch(`${API_BASE}/profiles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data })
        });

        if (res.ok) {
            closeProfileModal();
            loadProfiles();
        } else {
            alert('プロファイルの保存に失敗しました');
        }
    } catch (e) {
        alert('JSONの形式が正しくありません: ' + e.message);
    }
}

function editProfile(id, name, data) {
    document.getElementById('modalTitle').textContent = 'プロファイル編集';
    document.getElementById('profileName').value = name;
    document.getElementById('profileData').value = JSON.stringify(data, null, 2);
    document.getElementById('profileForm').dataset.editingId = id; // Store ID for editing
    document.getElementById('profileModal').classList.add('active');
}

async function deleteProfile(id) {
    if (!confirm('このプロファイルを削除しますか?')) return;

    try {
        const res = await fetch(`${API_BASE}/profiles/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            loadProfiles();
        } else {
            alert('削除に失敗しました');
        }
    } catch (e) {
        console.error('Failed to delete profile:', e);
        alert('削除に失敗しました');
    }
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function exportLogsAsCsv() {
    window.location.href = `${API_BASE}/logs/export`;
}

