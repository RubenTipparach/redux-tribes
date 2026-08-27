using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public abstract class GenericHoverInfo : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler
{
    public abstract string Message { get; }

    public void OnPointerEnter(PointerEventData eventData)
    {
        GameManager.Instance.uiManagerV2.ShowInfoBox(Message);
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        GameManager.Instance.uiManagerV2.HideInfoBox();
    }
}
