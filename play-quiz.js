(function () {
    var bank = (window.FREE_QUESTIONS || []).filter(function (q) {
        var answers = q.answers || [];
        return answers.length >= 4 && answers.every(function (a) { return String(a || "").trim(); }) && q.question;
    });
    var index = 0;
    var correctCount = 0;
    var streak = 0;
    var coins = 0;
    var locked = false;
    var shieldOn = false;
    var frozenUntil = 0;
    var endsAt = 0;
    var total = 30;
    var tick = null;
    var readTimer = null;
    var current = null;
    var music = document.getElementById("quiz-music");
    var quizView = document.getElementById("quiz-view");
    var wrongSnd = new Audio("audio/wrong-answer.mp3");
    var rightSnd = new Audio("audio/applause-claps.mp3");
    var ringCirc = 2 * Math.PI * 41;
    var correctPhrases = ["נפלא", "כל הכבוד!", "אשריך שזכית!", "תשובתך נכונה!", "יפה מאוד"];
    var wrongPhrases = ["זה חידוש שלך?", "הא טעות!", "שב תלמד שב!", "איפה למדת?"];
    var toolCost = { time: 3, skip: 5, reduce: 10, hint: 15, shield: 20 };

    music.volume = 0.72;
    function playMusic() { music.play().catch(function () {}); }
    playMusic();
    document.addEventListener("pointerdown", playMusic, { once: true });

    function stopQuizMusic() {
        music.pause();
        music.removeAttribute("src");
        try { music.load(); } catch (e) {}
    }

    function leave() {
        stopQuizMusic();
        try { sessionStorage.setItem("manach-study-music", "1"); } catch (e) {}
        location.href = "index.html";
    }

    window.addEventListener("pagehide", stopQuizMusic);
    document.getElementById("quiz-back-btn").addEventListener("click", leave);

    function secondsFor(question) {
        var long = (question.answers || []).filter(function (a) {
            return String(a || "").trim().split(/\s+/).length >= 20;
        }).length >= 3;
        var n = streak + 1;
        if (streak >= 15) return long ? 35 : 20;
        if (n <= 5) return long ? 45 : 30;
        if (n <= 10) return long ? 40 : 25;
        return long ? 35 : 20;
    }

    function shuffle(q) {
        var answers = q.answers.slice();
        var correct = Number(q.correct) || 0;
        if (q.shuffle) {
            var order = answers.map(function (_, i) { return i; });
            var i;
            for (i = order.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = order[i];
                order[i] = order[j];
                order[j] = tmp;
            }
            answers = order.map(function (n) { return q.answers[n]; });
            correct = order.indexOf(Number(q.correct) || 0);
        }
        return { question: q.question, answers: answers, correct: correct };
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function paintStats() {
        setText("coin-count", String(coins));
        setText("streak-count", String(streak));
        setText("quiz-progress", (index + 1) + "/" + bank.length);
    }

    function paintClock(left) {
        var timerEl = document.getElementById("quiz-timer");
        var clockEl = document.getElementById("quiz-timer-clock");
        var ringEl = document.getElementById("alarm-progress-ring");
        var shown = Math.max(0, Math.ceil(left));
        if (timerEl) timerEl.textContent = String(shown);
        if (clockEl) clockEl.classList.toggle("alarm-frozen", frozenUntil > Date.now());
        if (ringEl && total > 0) {
            ringEl.style.strokeDasharray = String(ringCirc);
            ringEl.style.strokeDashoffset = String(ringCirc * (1 - Math.max(0, left) / total));
        }
    }

    function showPhrase(isCorrect) {
        var layer = document.getElementById("answer-feedback-layer");
        if (!layer) return;
        var list = isCorrect ? correctPhrases : wrongPhrases;
        var text = list[Math.floor(Math.random() * list.length)];
        var popup = document.createElement("div");
        popup.className = "answer-feedback-popup " + (isCorrect ? "correct" : "wrong");
        popup.innerHTML = '<span class="answer-feedback-line" dir="rtl">' + text + "</span>";
        layer.appendChild(popup);
        layer.setAttribute("aria-hidden", "false");
        requestAnimationFrame(function () { popup.classList.add("show"); });
        window.setTimeout(function () {
            popup.classList.add("hide");
            window.setTimeout(function () {
                popup.remove();
                if (!layer.children.length) layer.setAttribute("aria-hidden", "true");
            }, 420);
        }, isCorrect ? 1200 : 1400);
    }

    function stopTick() {
        if (tick) clearInterval(tick);
        tick = null;
        if (readTimer) clearTimeout(readTimer);
        readTimer = null;
    }

    function finish() {
        stopTick();
        var overlay = document.getElementById("solo-summary-overlay");
        setText("solo-summary-total", String(bank.length));
        setText("solo-summary-correct", String(correctCount));
        setText("solo-summary-wrong", String(bank.length - correctCount));
        setText("solo-summary-accuracy", bank.length ? Math.round((correctCount / bank.length) * 100) + "%" : "—");
        var barCorrect = document.getElementById("solo-summary-bar-correct");
        var barWrong = document.getElementById("solo-summary-bar-wrong");
        if (barCorrect) barCorrect.style.width = (bank.length ? (correctCount / bank.length) * 100 : 0) + "%";
        if (barWrong) barWrong.style.width = (bank.length ? ((bank.length - correctCount) / bank.length) * 100 : 0) + "%";
        if (overlay) {
            overlay.hidden = false;
            overlay.classList.add("show");
            overlay.setAttribute("aria-hidden", "false");
            var popup = overlay.querySelector(".solo-summary-popup");
            if (popup) popup.classList.add("show");
        }
    }

    function beginTimer() {
        total = secondsFor(current);
        endsAt = Date.now() + total * 1000;
        frozenUntil = 0;
        paintClock(total);
        tick = setInterval(function () {
            if (frozenUntil > Date.now()) {
                endsAt += 200;
                paintClock((endsAt - Date.now()) / 1000);
                return;
            }
            var left = (endsAt - Date.now()) / 1000;
            paintClock(left);
            if (left <= 0) {
                stopTick();
                pick(-1);
            }
        }, 200);
    }

    function show() {
        if (!bank.length) {
            document.getElementById("question-text").textContent = "לא נמצאו שאלות לפרק.";
            return;
        }
        if (index >= bank.length) {
            finish();
            return;
        }
        locked = false;
        current = shuffle(bank[index]);
        paintStats();
        document.getElementById("quiz-subtitle").textContent = "ברכות - מאימתי";
        document.getElementById("question-text").textContent = current.question;
        var box = document.getElementById("answers-container");
        box.innerHTML = "";
        current.answers.forEach(function (text, i) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "answer-btn";
            btn.dir = "rtl";
            var num = document.createElement("span");
            num.className = "answer-number";
            num.textContent = String(i + 1);
            var label = document.createElement("span");
            label.className = "answer-text";
            label.dir = "rtl";
            label.textContent = text;
            btn.appendChild(num);
            btn.appendChild(label);
            btn.addEventListener("click", function () { pick(i); });
            box.appendChild(btn);
        });
        quizView.classList.add("is-question-reading");
        stopTick();
        readTimer = window.setTimeout(function () {
            quizView.classList.remove("is-question-reading");
            beginTimer();
        }, 4000);
    }

    function pick(choice) {
        if (locked || !current) return;
        if (quizView.classList.contains("is-question-reading")) return;
        locked = true;
        stopTick();
        var buttons = document.querySelectorAll("#answers-container .answer-btn");
        buttons.forEach(function (btn, i) {
            btn.disabled = true;
            if (i === current.correct) btn.classList.add("correct");
            if (i === choice && choice !== current.correct) btn.classList.add("wrong");
        });
        var ok = choice === current.correct;
        if (ok) {
            correctCount += 1;
            streak += 1;
            coins += 5;
            rightSnd.currentTime = 0;
            rightSnd.play().catch(function () {});
        } else if (shieldOn) {
            shieldOn = false;
            wrongSnd.currentTime = 0;
            wrongSnd.play().catch(function () {});
        } else {
            streak = 0;
            wrongSnd.currentTime = 0;
            wrongSnd.play().catch(function () {});
        }
        paintStats();
        showPhrase(ok);
        window.setTimeout(function () {
            index += 1;
            show();
        }, ok ? 1200 : 1400);
    }

    function useTool(name) {
        if (locked || quizView.classList.contains("is-question-reading")) return;
        var cost = toolCost[name];
        if (coins < cost) return;
        coins -= cost;
        paintStats();
        if (name === "time") {
            frozenUntil = Date.now() + 5000;
            paintClock((endsAt - Date.now()) / 1000);
        } else if (name === "skip") {
            locked = true;
            stopTick();
            index += 1;
            show();
        } else if (name === "reduce") {
            var wrong = [];
            document.querySelectorAll("#answers-container .answer-btn").forEach(function (btn, i) {
                if (i !== current.correct && !btn.classList.contains("hidden")) wrong.push(btn);
            });
            wrong.sort(function () { return Math.random() - 0.5; });
            wrong.slice(0, 2).forEach(function (btn) { btn.classList.add("hidden"); });
        } else if (name === "hint") {
            var correctBtn = document.querySelectorAll("#answers-container .answer-btn")[current.correct];
            if (correctBtn) correctBtn.classList.add("hint-reveal");
        } else if (name === "shield") {
            shieldOn = true;
        }
    }

    document.getElementById("quiz-tools").addEventListener("click", function (event) {
        var btn = event.target.closest("[data-tool]");
        if (!btn) return;
        useTool(btn.getAttribute("data-tool"));
    });

    document.getElementById("summary-back").addEventListener("click", leave);
    show();
})();
