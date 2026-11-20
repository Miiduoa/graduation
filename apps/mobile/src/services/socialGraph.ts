/* eslint-disable @typescript-eslint/no-explicit-any */
import { getFriendshipBetween, type Friendship } from './friends';
import { isFollowing } from './follows';
import { isUserBlocked } from './blockList';

export type RelationSnapshot = {
  friendship: Friendship | null;
  following: boolean;
  blockedEitherWay?: boolean;
};

export async function getRelationSnapshot(
  schoolId: string,
  myUid: string,
  peerUid: string,
): Promise<RelationSnapshot> {
  const [friendship, following, blk] = await Promise.all([
    getFriendshipBetween(schoolId, myUid, peerUid),
    isFollowing(schoolId, myUid, peerUid),
    isUserBlocked(myUid, peerUid),
  ]);
  return {
    friendship,
    following,
    blockedEitherWay: blk,
  };
}
