using System.Collections;
using System.Collections.Generic;
using System.Threading;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public class TimeSliderController : MonoBehaviour
{

    public Slider handle;

    public Slider mainSlider;

    public List<ActionQueueUI> queueUI;

    public Timing lerpTimer;
    float lastTime;
    float currentTime;
    float chosenTime;

    //float smoothTime;
    public float smoothTransitionSpeed;
    public void SetTime(float val)
    {
        lerpTimer.Init();
        lastTime = GameManager.Instance.selectedTime;
        chosenTime = val;
    }

    // Start is called before the first frame update
    void Start()
    {
        lastTime = 0;
        chosenTime = 0;
        lerpTimer.Init();
        // handle.onValueChanged.AddListener((val) =>
        // {
        //     SetTime(val);
        // });

        var eventTrigger = handle.GetComponent<EventTrigger>();
        EventTrigger.Entry entry = new EventTrigger.Entry();
        entry.eventID = EventTriggerType.PointerUp;
        entry.callback = new EventTrigger.TriggerEvent();
        entry.callback.AddListener(new UnityEngine.Events.UnityAction<BaseEventData>((eventData)=>{
            if (GameManager.Instance.simulationController.SimulationState == SimulationState.Planning)
            {
                int rounded = Mathf.RoundToInt(handle.value);
                handle.value = rounded;
                SetTime(rounded);
                //GameManager.Instance.uiManagerV2.weaponsPanel.UpdateWeaponSelection(GameManager.Instance.shipSelected, rounded);
                Debug.Log("set weapons previews.");
                PreviewTurnProgress(rounded);
            }
        }));
        
        eventTrigger.triggers.Add(entry);
    }

    // Update is called once per frame
    void Update()
    {
        if (GameManager.Instance.simulationController.SimulationState == SimulationState.Planning)
        {
            if (!lerpTimer.Completed())
            {
                currentTime = lerpTimer.GetProgressClamped * ( chosenTime - lastTime ) + lastTime;
                GameManager.Instance.selectedTime = currentTime;
                mainSlider.value = currentTime;
            }
            else
            {
                if (lastTime != currentTime)
                {
                    currentTime = chosenTime;
                    lastTime = currentTime;
                    GameManager.Instance.selectedTime = currentTime;
                    mainSlider.value = currentTime;
                }
            }
        }
    }

    public void MarkUI(int timeSelected)
    {
        queueUI[timeSelected].AttackMark();

    }

    public void UpdateAttackQueueUI(
        Dictionary<int, List<AttackInformation>> attackQueue
        )
    {
        for (int i = 0; i < 11; i++)
        {
            queueUI[i].ClearUI();
            if (attackQueue.ContainsKey(i) && attackQueue[i].Count > 0)
            {
                queueUI[i].ActivateUI(attackQueue[i]);
            }

        }
    }

    
    public void PreviewTurnProgress(int progress)
    {
        //mainSlider.value = progress;
        //GameManager.Instance.selectedTime = progress;
        //Debug.Log("time selected " + progress);

        // foreach (var wep in weaponControllersUI)
        // {
        //     if (timerSlider.value == 10)
        //     {
        //         wep.button.interactable = false;
        //     }
        //     else
        //     {
        //         wep.button.interactable = true;
        //     }
        // }
        var mainUi = GameManager.Instance.uiManagerV2;
        var shipSelected = GameManager.Instance.shipSelected;

        if (shipSelected != null && shipSelected.isPlayerShip)
        {
            mainUi.weaponsPanel.UpdateWeaponSelection(shipSelected, progress);
        }

    }
    
}


