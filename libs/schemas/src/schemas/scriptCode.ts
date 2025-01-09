import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
export class ScriptCode {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index({ unique: true })
  outPoint: string;

  @Column({ type: "varchar" })
  @Index()
  updatedAtHeight: string;

  @Column({ type: "varchar" })
  @Index()
  dataHash: string;

  @Column({ type: "varchar", nullable: true })
  @Index()
  typeHash: string | null;

  @Column({ type: "int" })
  size: number;

  @Column({ type: "int" })
  isSsri: boolean;

  @Column({ type: "int" })
  isSsriUdt: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
