#!/bin/sh
# מעלה את הגרסה העדכנית של האפליקציה לאתר: https://zmanbekef.github.io (מאגר zmanbekef/zmanbekef.github.io, ענף main)
# הקוד עצמו נשמר במאגר zd0542964361/zman-bekef. הכתובת הישנה שם (gh-pages) רק מעבירה לחדשה — ראו redirect/
cd "$(dirname "$0")" || exit 1
# גרסה חדשה בכל פרסום — כדי שהטלפונים יקבלו את העדכון (וההודעה ✨)
sed -i '' "s/^const CACHE = .*/const CACHE = 'zman-$(date +%Y%m%d%H%M%S)';/" app/sw.js
git add -A && git commit -q -m "עדכון האפליקציה" 2>/dev/null
git push -q origin main
git subtree split --prefix app -b gh-pages-tmp >/dev/null
git push -q -f site gh-pages-tmp:main
git branch -D gh-pages-tmp >/dev/null
echo "עלה! בעוד דקה-שתיים יופיע באתר."
