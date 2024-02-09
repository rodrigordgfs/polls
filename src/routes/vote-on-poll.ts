import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { z } from "zod";
import { redis } from "../lib/redis";

const voteOnPollBodySchema = z.object({
  pollOptionId: z.string().uuid(),
});

const voteOnPollParamsSchema = z.object({
  pollId: z.string().uuid(),
});

export async function voteOnPoll(app: FastifyInstance) {
  app.post(
    "/polls/:pollId/votes",
    async (request: FastifyRequest, response: FastifyReply) => {
      try {
        const { pollOptionId } = voteOnPollBodySchema.parse(request.body);
        const { pollId } = voteOnPollParamsSchema.parse(request.params);

        let { sessionId } = request.cookies;

        if (!sessionId) {
          sessionId = randomUUID();

          response.setCookie("sessionId", sessionId, {
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
            signed: true,
            httpOnly: true,
            sameSite: "strict",
            secure: true,
          });
        }

        const userPreviousVoteOnPoll = await prisma.vote.findUnique({
          where: {
            sessionId_pollId: {
              sessionId,
              pollId,
            },
          },
        });

        if (
          userPreviousVoteOnPoll &&
          userPreviousVoteOnPoll.pollOptionId !== pollOptionId
        ) {
          await prisma.vote.delete({
            where: {
              id: userPreviousVoteOnPoll.id,
            },
          });

          await redis.zincrby(pollId, -1, userPreviousVoteOnPoll.pollOptionId);
        } else if (userPreviousVoteOnPoll) {
          return response.status(400).send({
            message: "User has already voted for this option on this poll",
          });
        }

        await prisma.vote.create({
          data: {
            sessionId,
            pollId,
            pollOptionId,
          },
        });

        await redis.zincrby(pollId, 1, pollOptionId);

        return response.status(201).send();
      } catch (error) {
        console.error("Error processing vote on poll:", error);
        return response.status(500).send({
          message: "Internal server error",
        });
      }
    }
  );
}
