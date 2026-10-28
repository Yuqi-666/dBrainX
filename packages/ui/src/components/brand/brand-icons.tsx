// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from "react";
import { cn } from "@workspace/ui/lib/utils";
import graphLight from "../../img/icon/graph-light.svg";
import graphDark from "../../img/icon/graph-dark.svg";
import logoLight from "../../img/icon/logo-light.svg";
import logoDark from "../../img/icon/logo-dark.svg";

type BrandIconProps = ComponentProps<"span">;

function BrandIcon({
  className,
  light,
  dark,
  ...props
}: BrandIconProps & {
  light: string;
  dark: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0", className)} {...props}>
      <img src={light} alt="" aria-hidden className="size-full dark:hidden" />
      <img
        src={dark}
        alt=""
        aria-hidden
        className="hidden size-full dark:block"
      />
    </span>
  );
}

export function GraphIcon(props: BrandIconProps) {
  return <BrandIcon light={graphLight.src} dark={graphDark.src} {...props} />;
}

export function LogoIcon(props: BrandIconProps) {
  return <BrandIcon light={logoLight.src} dark={logoDark.src} {...props} />;
}
