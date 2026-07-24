<script setup lang="ts" vapor>
import { computed } from "vue";
import arrowRight from "lucide-static/icons/arrow-right.svg?no-inline";
import arrowUp from "lucide-static/icons/arrow-up.svg?no-inline";
import check from "lucide-static/icons/check.svg?no-inline";
import chevronDown from "lucide-static/icons/chevron-down.svg?no-inline";
import chevronRight from "lucide-static/icons/chevron-right.svg?no-inline";
import externalLink from "lucide-static/icons/external-link.svg?no-inline";
import listFilter from "lucide-static/icons/list-filter.svg?no-inline";
import loaderCircle from "lucide-static/icons/loader-circle.svg?no-inline";
import search from "lucide-static/icons/search.svg?no-inline";
import x from "lucide-static/icons/x.svg?no-inline";

const icons = {
  "arrow-right": arrowRight,
  "arrow-up": arrowUp,
  check,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
  "external-link": externalLink,
  "list-filter": listFilter,
  "loader-circle": loaderCircle,
  search,
  x,
};

const props = defineProps<{
  name: keyof typeof icons;
}>();

const maskImage = computed(() => `url("${icons[props.name]}")`);
</script>

<template>
  <span
    class="ui-icon"
    :style="{ maskImage, WebkitMaskImage: maskImage }"
    aria-hidden="true"
  ></span>
</template>
