'use client';

import {
  type CustomFieldEntity,
  customFieldListResponseSchema,
  type DescriptorNamespace,
  descriptorListResponseSchema,
} from '@emis/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

/** The choices currently in use for a dropdown list (retired ones are hidden). */
export function useDescriptorOptions(namespace: DescriptorNamespace) {
  return useQuery({
    queryKey: ['descriptors', namespace],
    queryFn: () =>
      apiRequest(`/descriptors?namespace=${namespace}`, { schema: descriptorListResponseSchema }),
    select: (data) => data.items.filter((item) => item.isActive),
  });
}

export function useCustomFieldDefinitions(entityType: CustomFieldEntity) {
  return useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () =>
      apiRequest(`/custom-fields?entityType=${entityType}`, {
        schema: customFieldListResponseSchema,
      }),
    select: (data) => data.items.filter((item) => item.isActive),
  });
}
