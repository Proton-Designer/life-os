export type CheckinTagType =
  | "kill_list"
  | "workout"
  | "deen"
  | "school"
  | "co_op"
  | "other_work"
  | "noise";

export type CheckinOption = {
  tagType: CheckinTagType;
  refId: string | null;
  label: string;
  primary: boolean;
};
