import Joi from "joi";
import { REGEX_OBJECT_ID } from "../../common/services/data/regex.service.js";

const ToDoSchema = Joi.object({
    userId: Joi.string().pattern(REGEX_OBJECT_ID).required(),
    name: Joi.string().required(),
    description: Joi.string().allow(""),
    startDate: Joi.date().required(),
    endDate: Joi.date().allow("").optional(),
    toDoStatus: Joi.string().optional().default("PENDING"),

    tasks: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        taskStatus: Joi.string().optional().default("PENDING"),
        priority: Joi.number().required(),
        notes: Joi.string().allow(""),
    })),

    notes: Joi.string().allow(""),
});

export default ToDoSchema;