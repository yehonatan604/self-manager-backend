import { DateTime } from "luxon";
import cron from "node-cron";
import { Server } from "socket.io";
import { NoteStatusTypes } from "../../../notes/enums/NoteStatusTypes.js";
import Note from "../../../notes/models/Note.js";
import NoteAutomation from "../../../notes/models/NoteAutomation.js";
import TaskStatusTypes from "../../../todos/enums/TaskStatusTypes.js";
import ToDo from "../../../todos/models/Todo.js";
import { verifyAuthToken } from "../jwt/jwt.service.js";
import { print } from "../logger/print.service.js";

const initializeSocketLogic = (socketServer) => {
    const io = new Server(socketServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        const userData = verifyAuthToken(token);

        if (!userData) {
            print("Invalid or missing token during socket connection", "error");
            return next(new Error("Unauthorized"));
        }

        socket.user = userData;
        socket.join(userData._id);
        next();
    });

    io.on("connection", (socket) => {
        print(`User connected: ${socket.user._id}`, "success");

        socket.emit("user-registered", socket.user._id);

        socket.on("disconnect", () => {
            print(`User disconnected: ${socket.user._id}`, "secondary");
        });
    });

    io.on("note-read", async (socket) => {
        const { id } = socket.data;
        const note = await Note.findById(id);
        if (!note) {
            print(`Note not found: ${id}`, "error");
            return;
        } else {
            await Note.updateOne(
                { _id: id },
                { noteStatus: NoteStatusTypes.READ }
            );
        }
    });

    cron.schedule("* * * * *", async () => {
        const now = DateTime.utc().startOf("minute");
        const automations = await NoteAutomation.find({ status: "active" });
        const toDos = await ToDo.find({
            status: "active",
            endDate: { $lte: new Date() }
        });

        for (const automation of automations) {
            const automationTime = DateTime.fromISO(automation.dateTime).startOf("minute");
            const lastTriggered = automation.lastTriggeredAt
                ? DateTime.fromJSDate(automation.lastTriggeredAt)
                : null;
            const nowHM = now.setZone("UTC").toFormat("HH:mm");
            const autoHM = automationTime.setZone("UTC").toFormat("HH:mm");
            let shouldTrigger = false;

            if (automation.repeat === "none") {
                shouldTrigger =
                    automationTime.equals(now) &&
                    (!lastTriggered || !lastTriggered.hasSame(now, "minute"));
            } else if (automation.repeat === "daily") {
                shouldTrigger =
                    nowHM === autoHM &&
                    (!lastTriggered || !lastTriggered.hasSame(now, "minute"));
            } else if (automation.repeat === "weekly") {
                shouldTrigger =
                    nowHM === autoHM &&
                    now.weekday === automationTime.weekday &&
                    (!lastTriggered || !lastTriggered.hasSame(now, "minute"));
            } else if (automation.repeat === "monthly") {
                shouldTrigger =
                    nowHM === autoHM &&
                    now.day === automationTime.day &&
                    (!lastTriggered || !lastTriggered.hasSame(now, "minute"));
            }

            if (shouldTrigger) {
                const note = await Note.findById(automation.noteId);
                print(`Triggering automation for user: ${automation.userId}`, "success");

                io.to(automation.userId.toString()).emit("note-automation-triggered", {
                    title: note.name,
                    content: note.content,
                });

                automation.lastTriggeredAt = now.toJSDate();
                await automation.save();
            }
        }

        for (const todo of toDos) {
            const gotNote = await Note.findOne({
                userId: todo.userId,
                name: `ToDo "${todo.name}" failed`,
            });
            const shouldTrigger = (
                todo.endDate
                && DateTime.fromJSDate(todo.endDate) < now
                && todo.toDoStatus !== TaskStatusTypes.FAILED
                && todo.toDoStatus !== TaskStatusTypes.COMPLETE
                && (!gotNote || gotNote.noteStatus === TaskStatusTypes.PENDING)
            );


            if (shouldTrigger) {
                let finalNote = gotNote;

                if (!gotNote) {
                    const newNote = new Note({
                        userId: todo.userId,
                        name: `ToDo "${todo.name}" failed`,
                        content: `Your ToDo "${todo.name}" has failed. Please check your tasks.`,
                        date: now.toJSDate(),
                    });
                    finalNote = await newNote.save();
                }

                io.to(todo.userId.toString()).emit("todo-failed", {
                    id: todo._id,
                    title: finalNote.name,
                    content: finalNote.content,
                    noteId: finalNote._id,
                });

                if (todo.toDoStatus !== TaskStatusTypes.FAILED) {
                    todo.toDoStatus = TaskStatusTypes.FAILED;
                    await todo.save();
                }
            }
        }
    });
};

export { initializeSocketLogic };

