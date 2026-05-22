/**
 * @brief intermediate representation (IR) used throughout indexing and querying.
 */
export interface IR {
  type: string;
  lineno_start: number;
  lineno_end: number;
  
}

export interface IRCollection {
}
