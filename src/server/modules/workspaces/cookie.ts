/**
 * The cookie that says which workspace this browser is looking at.
 *
 * Its own module because a `"use server"` file may export nothing but async
 * functions — a constant there silently strips every export from the module,
 * which is a build error two files away from the cause.
 */
export const WORKSPACE_COOKIE = "planora-workspace";
