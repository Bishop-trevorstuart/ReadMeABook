# Audiobookshelf Tag Sync

### 💡 The "Why"
In a multi-user audiobook library, "Availability" is only half the story. The real question is: **"Who is this book for?"**

Audiobookshelf is a powerful library organizer, but it doesn't natively know which of your users requested which book in RMAB. This script bridges that gap. By automatically tagging books with `Requester: [Username]`, it unlocks several features in your ABS library:
* **Personalized Filtering:** Users can click their name in the ABS sidebar to see only the books they personally requested.
* **Custom Collections:** Admins can easily build smart collections based on user interest.
* **Visibility:** It provides instant context in the ABS UI so you know exactly why a book was added to the library.

### 🛠️ Features
- **Smart User Mapping:** Cross-matches users across platforms to ensure accurate tagging.
    - **Unified Email Linker:** Uses the email address as the primary unique identifier to bridge RMAB/Plex and ABS/OIDC accounts.
    - **Fallback Logic:** If an email match isn't found, it gracefully falls back to the Plex username.
- **Data Preservation:** Uses a deep-merge strategy to ensure existing ABS genres, metadata, and manual tags are never overwritten.
- **Multi-User Ready:** Designed to handle multiple requesters per book (anticipating future RMAB updates).

### ⚙️ Configuration
The script looks for the following Environment Variables:
- `ABS_URL`: Your Audiobookshelf URL (e.g., https://abs.example.com)
- `ABS_TOKEN`: Your ABS API Token.
- `RMAB_CONTAINER`: Name of your RMAB Docker container (default: readmeabook).

### 🚀 Example Implementation (Linux Host)
If running on your host machine, use a Python virtual environment:

1. **Setup:**
   python3 -m venv venv
   source venv/bin/activate
   pip install requests

2. **Run:**
   ABS_URL="https://abs.yourdomain.com" ABS_TOKEN="your_token" python3 sync_tags.py

3. **Automation (Cron):**
   Add this to `crontab -e` to sync every 30 minutes:
   */30 * * * * ABS_URL="..." ABS_TOKEN="..." /path/to/venv/bin/python3 /path/to/sync_tags.py >> /var/log/abs_sync.log 2>&1
